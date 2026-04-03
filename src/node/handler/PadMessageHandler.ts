'use strict';
/**
 * The MessageHandler handles all Messages that comes from Socket.IO and controls the sessions
 */

/*
 * Copyright 2009 Google Inc., 2011 Peter 'Pita' Martischka (Primary Technology Ltd)
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS-IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {MapArrayType} from "../types/MapType";

import AttributeMap from '../../static/js/AttributeMap';
const padManager = require('../db/PadManager');
import {checkRep, cloneAText, compose, deserializeOps, follow, identity, inverse, makeAText, makeSplice, moveOpsToNewPool, mutateAttributionLines, mutateTextLines, oldLen, prepareForWire, splitAttributionLines, splitTextLines, unpack} from '../../static/js/Changeset';
import ChatMessage from '../../static/js/ChatMessage';
import AttributePool from '../../static/js/AttributePool';
const AttributeManager = require('../../static/js/AttributeManager');
const authorManager = require('../db/AuthorManager');
import padutils from '../../static/js/pad_utils';
import readOnlyManager from '../db/ReadOnlyManager';
import settings, {
  exportAvailable,
  abiwordAvailable,
  sofficeAvailable
} from '../utils/Settings';
const securityManager = require('../db/SecurityManager');
const plugins = require('../../static/js/pluginfw/plugin_defs');
import log4js from 'log4js';
const messageLogger = log4js.getLogger('message');
const accessLogger = log4js.getLogger('access');
const hooks = require('../../static/js/pluginfw/hooks');
const stats = require('../stats')
const assert = require('assert').strict;
import {RateLimiterMemory} from 'rate-limiter-flexible';
import {ChangesetRequest, PadUserInfo, SocketClientRequest} from "../types/SocketClientRequest";
import {APool, AText, PadAuthor, PadType} from "../types/PadType";
import {ChangeSet} from "../types/ChangeSet";
import {ChatMessageMessage, ClientReadyMessage, ClientSaveRevisionMessage, ClientSuggestUserName, ClientUserChangesMessage, ClientVarMessage, CustomMessage, PadDeleteMessage, UserNewInfoMessage} from "../../static/js/types/SocketIOMessage";
import {Builder} from "../../static/js/Builder";
const webaccess = require('../hooks/express/webaccess');
const { checkValidRev } = require('../utils/checkValidRev');

let rateLimiter:any;
let socketio: any = null;

hooks.deprecationNotices.clientReady = 'use the userJoin hook instead';

const addContextToError = (err:any, pfx:string) => {
  const newErr = new Error(`${pfx}${err.message}`, {cause: err});
  if (Error.captureStackTrace) Error.captureStackTrace(newErr, addContextToError);
  // Check for https://github.com/tc39/proposal-error-cause support, available in Node.js >= v16.10.
  if (newErr.cause === err) return newErr;
  err.message = `${pfx}${err.message}`;
  return err;
};

exports.socketio = () => {
  // The rate limiter is created in this hook so that restarting the server resets the limiter. The
  // settings.commitRateLimiting object is passed directly to the rate limiter so that the limits
  // can be dynamically changed during runtime by modifying its properties.
  rateLimiter = new RateLimiterMemory(settings.commitRateLimiting);
};

/**
 * Contains information about socket.io connections:
 *   - key: Socket.io socket ID.
 *   - value: Object that is initially empty immediately after connect. Once the client's
 *     CLIENT_READY message is processed, it has the following properties:
 *       - auth: Object with the following properties copied from the client's CLIENT_READY message:
 *           - padID: Pad ID requested by the user. Unlike the padId property described below, this
 *             may be a read-only pad ID.
 *           - sessionID: Copied from the client's sessionID cookie, which should be the value
 *             returned from the createSession() HTTP API. This will be null/undefined if
 *             createSession() isn't used or the portal doesn't set the sessionID cookie.
 *           - token: User-supplied token.
 *       - author: The user's author ID.
 *       - padId: The real (not read-only) ID of the pad.
 *       - readOnlyPadId: The read-only ID of the pad.
 *       - readonly: Whether the client has read-only access (true) or read/write access (false).
 *       - rev: The last revision that was sent to the client.
 */
const sessioninfos:MapArrayType<any> = {};
exports.sessioninfos = sessioninfos;

function getTotalActiveUsers() {
  return socketio ? socketio.engine.clientsCount : 0;
}

exports.getTotalActiveUsers = getTotalActiveUsers;

function getActivePadCountFromSessionInfos() {
  const padIds = new Set();
  for (const {padId} of Object.values(sessioninfos)) {
    if (!padId) continue;
    padIds.add(padId);
  }
  return padIds.size;
}
exports.getActivePadCountFromSessionInfos = getActivePadCountFromSessionInfos;

stats.gauge('totalUsers', () => getTotalActiveUsers());
stats.gauge('activePads', () => {
  return getActivePadCountFromSessionInfos();
});

/**
 * Processes one task at a time per channel.
 */
class Channels {
  private readonly _exec: (ch:any, task:any) => any;
  private _promiseChains: Map<any, Promise<any>>;
  /**
   * @param {(ch, task) => any} [exec] - Task executor. If omitted, tasks are assumed to be
   *     functions that will be executed with the channel as the only argument.
   */
  constructor(exec = (ch: string, task:any) => task(ch)) {
    this._exec = exec;
    this._promiseChains = new Map();
  }

  /**
   * Schedules a task for execution. The task will be executed once all previously enqueued tasks
   * for the named channel have completed.
   *
   * @param {any} ch - Identifies the channel.
   * @param {any} task - The task to give to the executor.
   * @returns {Promise<any>} The value returned by the executor.
   */
  async enqueue(ch:any, task:any): Promise<any> {
    const p = (this._promiseChains.get(ch) || Promise.resolve()).then(() => this._exec(ch, task));
    const pc = p
        .catch(() => {}) // Prevent rejections from halting the queue.
        .then(() => {
          // Clean up this._promiseChains if there are no more tasks for the channel.
          if (this._promiseChains.get(ch) === pc) this._promiseChains.delete(ch);
        });
    this._promiseChains.set(ch, pc);
    return await p;
  }
}

/**
 * A changeset queue per pad that is processed by handleUserChanges()
 */
const padChannels = new Channels((ch, {socket, message}) => handleUserChanges(socket, message));

/**
 * This Method is called by server.ts to tell the message handler on which socket it should send
 * @param socket_io The Socket
 */
exports.setSocketIO = (socket_io:any) => {
  socketio = socket_io;
};

/**
 * Handles the connection of a new user
 * @param socket the socket.io Socket object for the new connection from the client
 */
exports.handleConnect = (socket:any) => {
  stats.meter('connects').mark();

  // Initialize sessioninfos for this new session
  sessioninfos[socket.id] = {};
};

/**
 * Kicks all sessions from a pad
 */
exports.kickSessionsFromPad = (padID: string) => {

  if(socketio.sockets == null) return;

  // skip if there is nobody on this pad
  if (_getRoomSockets(padID).length === 0) return;

  // disconnect everyone from this pad
  socketio.in(padID).emit('message', {disconnect: 'deleted'});
};

/**
 * Handles the disconnection of a user
 * @param socket the socket.io Socket object for the client
 */
exports.handleDisconnect = async (socket:any) => {
  stats.meter('disconnects').mark();
  const session = sessioninfos[socket.id];
  delete sessioninfos[socket.id];
  // session.padId can be nullish if the user disconnects before sending CLIENT_READY.
  if (!session || !session.author || !session.padId) return;
  const {session: {user} = {}} = socket.client.request as SocketClientRequest;
  /* eslint-disable prefer-template -- it doesn't support breaking across multiple lines */
  accessLogger.info('[LEAVE]' +
                    ` pad:${session.padId}` +
                    ` socket:${socket.id}` +
                    ` IP:${settings.disableIPlogging ? 'ANONYMOUS' : socket.request.ip}` +
                    ` authorID:${session.author}` +
                    (user && user.username ? ` username:${user.username}` : ''));
  /* eslint-enable prefer-template */
  socket.broadcast.to(session.padId).emit('message', {
    type: 'COLLABROOM',
    data: {
      type: 'USER_LEAVE',
      userInfo: {
        colorId: await authorManager.getAuthorColorId(session.author),
        userId: session.author,
      },
    },
  });
  await hooks.aCallAll('userLeave', {
    ...session, // For backwards compatibility.
    authorId: session.author,
    readOnly: session.readonly,
    socket,
  });
};


const handlePadDelete = async (socket: any, padDeleteMessage: PadDeleteMessage) => {
  const session = sessioninfos[socket.id];
  if (!session || !session.author || !session.padId) throw new Error('session not ready');
  if (await padManager.doesPadExist(padDeleteMessage.data.padId)) {
    const retrievedPad = await padManager.getPad(padDeleteMessage.data.padId)
    // Only the one doing the first revision can delete the pad, otherwise people could troll a lot
    const firstContributor = await retrievedPad.getRevisionAuthor(0)
    if (session.author === firstContributor) {
      retrievedPad.remove()
    } else {

      type ShoutMessage = {
        message: string,
        sticky: boolean,
      }

      const messageToShout: ShoutMessage = {
        message: 'You are not the creator of this pad, so you cannot delete it',
        sticky: false
      }
      const messageToSend = {
        type: "COLLABROOM",
        data: {
          type: "shoutMessage",
          payload: {
            message: messageToShout,
            timestamp: Date.now()
          }
        }
      }
      socket.emit('shout',
        messageToSend
      )
    }
  }
}


/**
 * Handles a message from a user
 * @param socket the socket.io Socket object for the client
 * @param message the message from the client
 */
exports.handleMessage = async (socket:any, message: ClientVarMessage) => {
  const env = process.env.NODE_ENV || 'development';

  if (env === 'production') {
    try {
      await rateLimiter.consume(socket.request.ip); // consume 1 point per event from IP
    } catch (err) {
      messageLogger.warn(`Rate limited IP ${socket.request.ip}. To reduce the amount of rate ` +
                         'limiting that happens edit the rateLimit values in settings.json');
      stats.meter('rateLimited').mark();
      socket.emit('message', {disconnect: 'rateLimited'});
      throw err;
    }
  }

  if (message == null) throw new Error('message is null');
  if (!message.type) throw new Error('message type missing');

  const thisSession = sessioninfos[socket.id];
  if (!thisSession) throw new Error('message from an unknown connection');

  if (message.type === 'CLIENT_READY') {
    // Remember this information since we won't have the cookie in further socket.io messages. This
    // information will be used to check if the sessionId of this connection is still valid since it
    // could have been deleted by the API.
    thisSession.auth = {
      sessionID: message.sessionID,
      padID: message.padId,
      token: message.token,
    };

    // Pad does not exist, so we need to sanitize the id
    if (!(await padManager.doesPadExist(thisSession.auth.padID))) {
      thisSession.auth.padID = await padManager.sanitizePadId(thisSession.auth.padID);
    }
    const padIds = await readOnlyManager.getIds(thisSession.auth.padID);
    thisSession.padId = padIds.padId;
    thisSession.readOnlyPadId = padIds.readOnlyPadId;
    thisSession.readonly =
        padIds.readonly || !webaccess.userCanModify(thisSession.auth.padID, socket.client.request);
  }
  // Outside of the checks done by this function, message.padId must not be accessed because it is
  // too easy to introduce a security vulnerability that allows malicious users to read or modify
  // pads that they should not be able to access. Code should instead use
  // sessioninfos[socket.id].padId if the real pad ID is needed or
  // sessioninfos[socket.id].auth.padID if the original user-supplied pad ID is needed.
  Object.defineProperty(message, 'padId', {get: () => {
    throw new Error('message.padId must not be accessed (for security reasons)');
  }});

  const auth = thisSession.auth;
  if (!auth) {
    const ip = settings.disableIPlogging ? 'ANONYMOUS' : (socket.request.ip || '<unknown>');
    const msg = JSON.stringify(message, null, 2);
    throw new Error(`pre-CLIENT_READY message from IP ${ip}: ${msg}`);
  }

  const {session: {user} = {}} = socket.client.request as SocketClientRequest;
  const {accessStatus, authorID} =
      await securityManager.checkAccess(auth.padID, auth.sessionID, auth.token, user);
  if (accessStatus !== 'grant') {
    socket.emit('message', {accessStatus});
    throw new Error('access denied');
  }
  if (thisSession.author != null && thisSession.author !== authorID) {
    socket.emit('message', {disconnect: 'rejected'});
    throw new Error([
      'Author ID changed mid-session. Bad or missing token or sessionID?',
      `socket:${socket.id}`,
      `IP:${settings.disableIPlogging ? 'ANONYMOUS' : socket.request.ip}`,
      `originalAuthorID:${thisSession.author}`,
      `newAuthorID:${authorID}`,
      ...(user && user.username) ? [`username:${user.username}`] : [],
      `message:${message}`,
    ].join(' '));
  }
  thisSession.author = authorID;

  // Allow plugins to bypass the readonly message blocker
  let readOnly = thisSession.readonly;
  const context = {
    message,
    sessionInfo: {
      authorId: thisSession.author,
      padId: thisSession.padId,
      readOnly: thisSession.readonly,
    },
    socket,
    get client() {
      padutils.warnDeprecated(
          'the `client` context property for the handleMessageSecurity and handleMessage hooks ' +
          'is deprecated; use the `socket` property instead');
      return this.socket;
    },
  };
  for (const res of await hooks.aCallAll('handleMessageSecurity', context)) {
    switch (res) {
      case true:
        padutils.warnDeprecated(
            'returning `true` from a `handleMessageSecurity` hook function is deprecated; ' +
            'return "permitOnce" instead');
        thisSession.readonly = false;
        // Fall through:
      case 'permitOnce':
        readOnly = false;
        break;
      default:
        messageLogger.warn(
            'Ignoring unsupported return value from handleMessageSecurity hook function:', res);
    }
  }

  // Call handleMessage hook. If a plugin returns null, the message will be dropped.
  if ((await hooks.aCallAll('handleMessage', context)).some((m: null|string) => m == null)) {
    return;
  }

  // Drop the message if the client disconnected during the above processing.
  if (sessioninfos[socket.id] !== thisSession) throw new Error('client disconnected');

  const {type} = message;
  try {
    switch (type) {
      case 'CLIENT_READY': await handleClientReady(socket, message); break;
      case 'CHANGESET_REQ': await handleChangesetRequest(socket, message); break;
      case 'COLLABROOM': {
        if (readOnly) throw new Error('write attempt on read-only pad');
        const {type} = message.data;
        try {
          switch (type) {
            case 'USER_CHANGES':
              stats.counter('pendingEdits').inc();
              await padChannels.enqueue(thisSession.padId, {socket, message});
              break;
            case 'PAD_DELETE': await handlePadDelete(socket, message.data as unknown as PadDeleteMessage); break;
            case 'USERINFO_UPDATE': await handleUserInfoUpdate(socket, message as unknown as UserNewInfoMessage); break;
            case 'CHAT_MESSAGE': await handleChatMessage(socket, message as unknown as ChatMessageMessage); break;
            case 'GET_CHAT_MESSAGES': await handleGetChatMessages(socket, message); break;
            case 'SAVE_REVISION': await handleSaveRevisionMessage(socket, message as unknown as ClientSaveRevisionMessage); break;
            case 'CLIENT_MESSAGE': {
              const {type} = message.data.payload;
              try {
                switch (type) {
                  case 'suggestUserName': handleSuggestUserName(socket, message as unknown as ClientSuggestUserName); break;
                  default: throw new Error('unknown message type');
                }
              } catch (err) {
                throw addContextToError(err, `${type}: `);
              }
              break;
            }
            default: throw new Error('unknown message type');
          }
        } catch (err) {
          throw addContextToError(err, `${type}: `);
        }
        break;
      }
      default: throw new Error('unknown message type');
    }
  } catch (err) {
    throw addContextToError(err, `${type}: `);
  }
};


/**
 * Handles a save revision message
 * @param socket the socket.io Socket object for the client
 * @param message the message from the client
 */
const handleSaveRevisionMessage = async (socket:any, message: ClientSaveRevisionMessage) => {
  const {padId, author: authorId} = sessioninfos[socket.id];
  const pad = await padManager.getPad(padId, null, authorId);
  await pad.addSavedRevision(pad.head, authorId);
};

/**
 * Handles a custom message, different to the function below as it handles
 * objects not strings and you can direct the message to specific sessionID
 *
 * @param msg {Object} the message we're sending
 * @param sessionID {string} the socketIO session to which we're sending this message
 */
exports.handleCustomObjectMessage = (msg: CustomMessage, sessionID: string) => {
  if (msg.data.type === 'CUSTOM') {
    if (sessionID) {
      // a sessionID is targeted: directly to this sessionID
      socketio.sockets.socket(sessionID).emit('message', msg);
    } else {
      // broadcast to all clients on this pad
      socketio.sockets.in(msg.data.payload.padId).emit('message', msg);
    }
  }
};

/**
 * Handles a custom message (sent via HTTP API request)
 *
 * @param padID {Pad} the pad to which we're sending this message
 * @param msgString {String} the message we're sending
 */
exports.handleCustomMessage = (padID: string, msgString:string) => {
  const time = Date.now();
  const msg = {
    type: 'COLLABROOM',
    data: {
      type: msgString,
      time,
    },
  };
  socketio.sockets.in(padID).emit('message', msg);
};

/**
 * Handles a Chat Message
 * @param socket the socket.io Socket object for the client
 * @param message the message from the client
 */
const handleChatMessage = async (socket:any, message: ChatMessageMessage) => {
  const chatMessage = ChatMessage.fromObject(message.data.message);
  const {padId, author: authorId} = sessioninfos[socket.id];
  // Don't trust the user-supplied values.
  chatMessage.time = Date.now();
  chatMessage.authorId = authorId;
  await exports.sendChatMessageToPadClients(chatMessage, padId);
};

/**
 * Adds a new chat message to a pad and sends it to connected clients.
 *
 * @param {(ChatMessage|number)} mt - Either a chat message object (recommended) or the timestamp of
 *     the chat message in ms since epoch (deprecated).
 * @param {string} puId - If `mt` is a chat message object, this is the destination pad ID.
 *     Otherwise, this is the user's author ID (deprecated).
 * @param {string} [text] - The text of the chat message. Deprecated; use `mt.text` instead.
 * @param {string} [padId] - The destination pad ID. Deprecated; pass a chat message
 *     object as the first argument and the destination pad ID as the second argument instead.
 */
exports.sendChatMessageToPadClients = async (mt: ChatMessage|number, puId: string, text:string|null = null, padId:string|null = null) => {
  const message = mt instanceof ChatMessage ? mt : new ChatMessage(text, puId, mt);
  padId = mt instanceof ChatMessage ? puId : padId;
  const pad = await padManager.getPad(padId, null, message.authorId);
  await hooks.aCallAll('chatNewMessage', {message, pad, padId});
  // pad.appendChatMessage() ignores the displayName property so we don't need to wait for
  // authorManager.getAuthorName() to resolve before saving the message to the database.
  const promise = pad.appendChatMessage(message);
  message.displayName = await authorManager.getAuthorName(message.authorId);
  socketio.sockets.in(padId).emit('message', {
    type: 'COLLABROOM',
    data: {type: 'CHAT_MESSAGE', message},
  });
  await promise;
};

/**
 * Handles the clients request for more chat-messages
 * @param socket the socket.io Socket object for the client
 * @param message the message from the client
 */
const handleGetChatMessages = async (socket:any, {data: {start, end}}:any) => {
  if (!Number.isInteger(start)) throw new Error(`missing or invalid start: ${start}`);
  if (!Number.isInteger(end)) throw new Error(`missing or invalid end: ${end}`);
  const count = end - start;
  if (count < 0 || count > 100) throw new Error(`invalid number of messages: ${count}`);
  const {padId, author: authorId} = sessioninfos[socket.id];
  const pad = await padManager.getPad(padId, null, authorId);

  const chatMessages = await pad.getChatMessages(start, end);
  const infoMsg = {
    type: 'COLLABROOM',
    data: {
      type: 'CHAT_MESSAGES',
      messages: chatMessages,
    },
  };

  // send the messages back to the client
  socket.emit('message', infoMsg);
};

/**
 * Handles a handleSuggestUserName, that means a user have suggest a userName for a other user
 * @param socket the socket.io Socket object for the client
 * @param message the message from the client
 */
const handleSuggestUserName = (socket:any, message: ClientSuggestUserName) => {
  const {newName, unnamedId} = message.data.payload;
  if (newName == null) throw new Error('missing newName');
  if (unnamedId == null) throw new Error('missing unnamedId');
  const padId = sessioninfos[socket.id].padId;
  // search the author and send him this message
  _getRoomSockets(padId).forEach((socket) => {
    const session = sessioninfos[socket.id];
    if (session && session.author === unnamedId) {
      socket.emit('message', message);
    }
  });
};

/**
 * Handles a USERINFO_UPDATE, that means that a user have changed his color or name.
 * Anyway, we get both informations
 * @param socket the socket.io Socket object for the client
 * @param message the message from the client
 */
const handleUserInfoUpdate = async (socket:any, {data: {userInfo: {name, colorId}}}: UserNewInfoMessage) => {
  if (colorId == null) throw new Error('missing colorId');
  if (!name) name = null;
  const session = sessioninfos[socket.id];
  if (!session || !session.author || !session.padId) throw new Error('session not ready');
  const author = session.author;
  if (!/(^#[0-9A-F]{6}$)|(^#[0-9A-F]{3}$)/i.test(colorId)) {
    throw new Error(`malformed color: ${colorId}`);
  }

  // Tell the authorManager about the new attributes
  const p = Promise.all([
    authorManager.setAuthorColorId(author, colorId),
    authorManager.setAuthorName(author, name),
  ]);

  const padId = session.padId;

  const infoMsg = {
    type: 'COLLABROOM',
    data: {
      // The Client doesn't know about USERINFO_UPDATE, use USER_NEWINFO
      type: 'USER_NEWINFO',
      userInfo: {userId: author, name, colorId},
    },
  };

  // Send the other clients on the pad the update message
  socket.broadcast.to(padId).emit('message',infoMsg);

  // Block until the authorManager has stored the new attributes.
  await p;
};

/**
 * Handles a USER_CHANGES message, where the client submits its local
 * edits as a changeset.
 *
 * This handler's job is to update the incoming changeset so that it applies
 * to the latest revision, then add it to the pad, broadcast the changes
 * to all other clients, and send a confirmation to the submitting client.
 *
 * This function is based on a similar one in the original Etherpad.
 *   See https://github.com/ether/pad/blob/master/etherpad/src/etherpad/collab/collab_server.js in the function applyUserChanges()
 *
 * @param socket the socket.io Socket object for the client
 * @param message the message from the client
 */
const handleUserChanges = async (socket:any, message: {
  data: ClientUserChangesMessage
}) => {
  // This one's no longer pending, as we're gonna process it now
  stats.counter('pendingEdits').dec();

  // The client might disconnect between our callbacks. We should still
  // finish processing the changeset, so keep a reference to the session.
  const thisSession = sessioninfos[socket.id];

  // TODO: this might happen with other messages too => find one place to copy the session
  // and always use the copy. atm a message will be ignored if the session is gone even
  // if the session was valid when the message arrived in the first place
  if (!thisSession) throw new Error('client disconnected');

  // Measure time to process edit
  const stopWatch = stats.timer('edits').start();
  try {
    const {data: {baseRev, apool, changeset}} = message;
    if (baseRev == null) throw new Error('missing baseRev');
    if (apool == null) throw new Error('missing apool');
    if (changeset == null) throw new Error('missing changeset');
    const wireApool = (new AttributePool()).fromJsonable(apool);
    const pad = await padManager.getPad(thisSession.padId, null, thisSession.author);

    // Verify that the changeset has valid syntax and is in canonical form
    checkRep(changeset);

    // Validate all added 'author' attribs to be the same value as the current user
    for (const op of deserializeOps(unpack(changeset).ops)) {
      // + can add text with attribs
      // = can change or add attribs
      // - can have attribs, but they are discarded and don't show up in the attribs -
      // but do show up in the pool

      // Besides verifying the author attribute, this serves a second purpose:
      // AttributeMap.fromString() ensures that all attribute numbers are valid (it will throw if
      // an attribute number isn't in the pool).
      const opAuthorId = AttributeMap.fromString(op.attribs, wireApool).get('author');
      if (opAuthorId && opAuthorId !== thisSession.author) {
        throw new Error(`Author ${thisSession.author} tried to submit changes as author ` +
                        `${opAuthorId} in changeset ${changeset}`);
      }
    }

    // ex. adoptChangesetAttribs

    // Afaik, it copies the new attributes from the changeset, to the global Attribute Pool
    let rebasedChangeset = moveOpsToNewPool(changeset, wireApool, pad.pool);

    // ex. applyUserChanges
    let r = baseRev;

    // The client's changeset might not be based on the latest revision,
    // since other clients are sending changes at the same time.
    // Update the changeset so that it can be applied to the latest revision.
    while (r < pad.getHeadRevisionNumber()) {
      r++;
      const {changeset: c, meta: {author: authorId}} = await pad.getRevision(r);
      if (changeset === c && thisSession.author === authorId) {
        // Assume this is a retransmission of an already applied changeset.
        rebasedChangeset = identity(unpack(changeset).oldLen);
      }
      // At this point, both "c" (from the pad) and "changeset" (from the
      // client) are relative to revision r - 1. The follow function
      // rebases "changeset" so that it is relative to revision r
      // and can be applied after "c".
      rebasedChangeset = follow(c, rebasedChangeset, false, pad.pool);
    }

    const prevText = pad.text();

    if (oldLen(rebasedChangeset) !== prevText.length) {
      throw new Error(
          `Can't apply changeset ${rebasedChangeset} with oldLen ` +
          `${oldLen(rebasedChangeset)} to document of length ${prevText.length}`);
    }

    const newRev = await pad.appendRevision(rebasedChangeset, thisSession.author);
    // The head revision will either stay the same or increase by 1 depending on whether the
    // changeset has a net effect.
    assert([r, r + 1].includes(newRev));

    const correctionChangeset = _correctMarkersInPad(pad.atext, pad.pool);
    if (correctionChangeset) {
      await pad.appendRevision(correctionChangeset, thisSession.author);
    }

    // Make sure the pad always ends with an empty line.
    if (pad.text().lastIndexOf('\n') !== pad.text().length - 1) {
      const nlChangeset = makeSplice(pad.text(), pad.text().length - 1, 0, '\n');
      await pad.appendRevision(nlChangeset, thisSession.author);
    }

    // The client assumes that ACCEPT_COMMIT and NEW_CHANGES messages arrive in order. Make sure we
    // have already sent any previous ACCEPT_COMMIT and NEW_CHANGES messages.
    assert.equal(thisSession.rev, r);
    socket.emit('message', {type: 'COLLABROOM', data: {type: 'ACCEPT_COMMIT', newRev}});
    thisSession.rev = newRev;
    if (newRev !== r) thisSession.time = await pad.getRevisionDate(newRev);
    await exports.updatePadClients(pad);
  } catch (err:any) {
    socket.emit('message', {disconnect: 'badChangeset'});
    stats.meter('failedChangesets').mark();
    messageLogger.warn(`Failed to apply USER_CHANGES from author ${thisSession.author} ` +
                       `(socket ${socket.id}) on pad ${thisSession.padId}: ${err.stack || err}`);
  } finally {
    stopWatch.end();
  }
};

exports.updatePadClients = async (pad: PadType) => {
  // skip this if no-one is on this pad
  const roomSockets = _getRoomSockets(pad.id);
  if (roomSockets.length === 0) return;

  // since all clients usually get the same set of changesets, store them in local cache
  // to remove unnecessary roundtrip to the datalayer
  // NB: note below possibly now accommodated via the change to promises/async
  // TODO: in REAL world, if we're working without datalayer cache,
  // all requests to revisions will be fired
  // BEFORE first result will be landed to our cache object.
  // The solution is to replace parallel processing
  // via async.forEach with sequential for() loop. There is no real
  // benefits of running this in parallel,
  // but benefit of reusing cached revision object is HUGE
  const revCache:MapArrayType<any> = {};

  await Promise.all(roomSockets.map(async (socket) => {
    const sessioninfo = sessioninfos[socket.id];
    // The user might have disconnected since _getRoomSockets() was called.
    if (sessioninfo == null) return;

    while (sessioninfo.rev < pad.getHeadRevisionNumber()) {
      const r = sessioninfo.rev + 1;
      let revision = revCache[r];
      if (!revision) {
        revision = await pad.getRevision(r);
        revCache[r] = revision;
      }

      const author = revision.meta.author;
      const revChangeset = revision.changeset;
      const currentTime = revision.meta.timestamp;

      const forWire = prepareForWire(revChangeset, pad.pool);
      const msg = {
        type: 'COLLABROOM',
        data: {
          type: 'NEW_CHANGES',
          newRev: r,
          changeset: forWire.translated,
          apool: forWire.pool,
          author,
          currentTime,
          timeDelta: currentTime - sessioninfo.time,
        },
      };
      try {
        socket.emit('message', msg);
      } catch (err:any) {
        messageLogger.error(`Failed to notify user of new revision: ${err.stack || err}`);
        return;
      }
      sessioninfo.time = currentTime;
      sessioninfo.rev = r;
    }
  }));
};

/**
 * Copied from the Etherpad Source Code. Don't know what this method does excatly...
 */
const _correctMarkersInPad = (atext: AText, apool: AttributePool) => {
  const text = atext.text;

  // collect char positions of line markers (e.g. bullets) in new atext
  // that aren't at the start of a line
  const badMarkers = [];
  let offset = 0;
  for (const op of deserializeOps(atext.attribs)) {
    const attribs = AttributeMap.fromString(op.attribs, apool);
    const hasMarker = AttributeManager.lineAttributes.some((a: string) => attribs.has(a));
    if (hasMarker) {
      for (let i = 0; i < op.chars; i++) {
        if (offset > 0 && text.charAt(offset - 1) !== '\n') {
          badMarkers.push(offset);
        }
        offset++;
      }
    } else {
      offset += op.chars;
    }
  }

  if (badMarkers.length === 0) {
    return null;
  }

  // create changeset that removes these bad markers
  offset = 0;

  const builder = new Builder(text.length);

  badMarkers.forEach((pos) => {
    builder.keepText(text.substring(offset, pos));
    builder.remove(1);
    offset = pos + 1;
  });

  return builder.toString();
};

/**
 * Handles a CLIENT_READY. A CLIENT_READY is the first message from the client
 * to the server. The Client sends his token
 * and the pad it wants to enter. The Server answers with the inital values (clientVars) of the pad
 * @param socket the socket.io Socket object for the client
 * @param message the message from the client
 */
const handleClientReady = async (socket:any, message: ClientReadyMessage) => {
  const sessionInfo = sessioninfos[socket.id];
  if (sessionInfo == null) throw new Error('client disconnected');
  assert(sessionInfo.author);

  await hooks.aCallAll('clientReady', message); // Deprecated due to awkward context.

  let {colorId: authorColorId, name: authorName} = message.userInfo || {};
  if (authorColorId && !/^#(?:[0-9A-F]{3}){1,2}$/i.test(authorColorId as string)) {
    messageLogger.warn(`Ignoring invalid colorId in CLIENT_READY message: ${authorColorId}`);
    // @ts-ignore
    authorColorId = null;
  }
  await Promise.all([
    authorName && authorManager.setAuthorName(sessionInfo.author, authorName),
    authorColorId && authorManager.setAuthorColorId(sessionInfo.author, authorColorId),
  ]);
  ({colorId: authorColorId, name: authorName} = await authorManager.getAuthor(sessionInfo.author));

  // load the pad-object from the database
  const pad = await padManager.getPad(sessionInfo.padId, null, sessionInfo.author);

  // these db requests all need the pad object (timestamp of latest revision, author data)
  const authors = pad.getAllAuthors();

  // get timestamp of latest revision needed for timeslider
  const currentTime = await pad.getRevisionDate(pad.getHeadRevisionNumber());

  // get all author data out of the database (in parallel)
  const historicalAuthorData:MapArrayType<{
    name: string;
    colorId: string;
  }> = {};
  await Promise.all(authors.map(async (authorId: string) => {
    const author = await authorManager.getAuthor(authorId);
    if (!author) {
      messageLogger.error(`There is no author for authorId: ${authorId}. ` +
          'This is possibly related to https://github.com/ether/etherpad-lite/issues/2802');
    } else {
      // Filter author attribs (e.g. don't send author's pads to all clients)
      historicalAuthorData[authorId] = {name: author.name, colorId: author.colorId};
    }
  }));

  // glue the clientVars together, send them and tell the other clients that a new one is there

  // Check if the user has disconnected during any of the above awaits.
  if (sessionInfo !== sessioninfos[socket.id]) throw new Error('client disconnected');

  // Check if this author is already on the pad, if yes, kick the other sessions!
  const roomSockets = _getRoomSockets(pad.id);

  for (const otherSocket of roomSockets) {
    // The user shouldn't have joined the room yet, but check anyway just in case.
    if (otherSocket.id === socket.id) continue;
    const sinfo = sessioninfos[otherSocket.id];
    if (sinfo && sinfo.author === sessionInfo.author) {
      // fix user's counter, works on page refresh or if user closes browser window and then rejoins
      sessioninfos[otherSocket.id] = {};
      otherSocket.leave(sessionInfo.padId);
      otherSocket.emit('message', {disconnect: 'userdup'});
    }
  }

  const {session: {user} = {}} = socket.client.request as SocketClientRequest;
  /* eslint-disable prefer-template -- it doesn't support breaking across multiple lines */
  accessLogger.info(`[${pad.head > 0 ? 'ENTER' : 'CREATE'}]` +
                    ` pad:${sessionInfo.padId}` +
                    ` socket:${socket.id}` +
                    ` IP:${settings.disableIPlogging ? 'ANONYMOUS' : socket.request.ip}` +
                    ` authorID:${sessionInfo.author}` +
                    (user && user.username ? ` username:${user.username}` : ''));
  /* eslint-enable prefer-template */

  if (message.reconnect) {
    // If this is a reconnect, we don't have to send the client the ClientVars again
    // Join the pad and start receiving updates
    socket.join(sessionInfo.padId);

    // Save the revision in sessioninfos, we take the revision from the info the client send to us
    sessionInfo.rev = message.client_rev;

    // During the client reconnect, client might miss some revisions from other clients.
    // By using client revision,
    // this below code sends all the revisions missed during the client reconnect
    const revisionsNeeded = [];
    const changesets:MapArrayType<any> = {};

    let startNum = message.client_rev! + 1;
    let endNum = pad.getHeadRevisionNumber() + 1;

    const headNum = pad.getHeadRevisionNumber();

    if (endNum > headNum + 1) {
      endNum = headNum + 1;
    }

    if (startNum < 0) {
      startNum = 0;
    }

    for (let r = startNum; r < endNum; r++) {
      revisionsNeeded.push(r);
      changesets[r] = {};
    }

    await Promise.all(revisionsNeeded.map(async (revNum) => {
      const cs = changesets[revNum];
      [cs.changeset, cs.author, cs.timestamp] = await Promise.all([
        pad.getRevisionChangeset(revNum),
        pad.getRevisionAuthor(revNum),
        pad.getRevisionDate(revNum),
      ]);
    }));

    // return pending changesets
    for (const r of revisionsNeeded) {
      const forWire = prepareForWire(changesets[r].changeset, pad.pool);
      const wireMsg = {type: 'COLLABROOM',
        data: {type: 'CLIENT_RECONNECT',
          headRev: pad.getHeadRevisionNumber(),
          newRev: r,
          changeset: forWire.translated,
          apool: forWire.pool,
          author: changesets[r].author,
          currentTime: changesets[r].timestamp}};
      socket.emit('message', wireMsg);
    }

    if (startNum === endNum) {
      const Msg = {type: 'COLLABROOM',
        data: {type: 'CLIENT_RECONNECT',
          noChanges: true,
          newRev: pad.getHeadRevisionNumber()}};
      socket.emit('message', Msg);
    }
  } else {
    // This is a normal first connect
    let atext;
    let apool;
    // prepare all values for the wire, there's a chance that this throws, if the pad is corrupted
    try {
      atext = cloneAText(pad.atext);
      const attribsForWire = prepareForWire(atext.attribs, pad.pool);
      apool = attribsForWire.pool.toJsonable();
      atext.attribs = attribsForWire.translated;
    } catch (e:any) {
      messageLogger.error(e.stack || e);
      socket.emit('message', {disconnect: 'corruptPad'}); // pull the brakes
      throw new Error('corrupt pad');
    }

    // Warning: never ever send sessionInfo.padId to the client. If the client is read only you
    // would open a security hole 1 swedish mile wide...
    const clientVars:MapArrayType<any> = {
      skinName: settings.skinName,
      skinVariants: settings.skinVariants,
      randomVersionString: settings.randomVersionString,
      accountPrivs: {
        maxRevisions: 100,
      },
      enableDarkMode: settings.enableDarkMode,
      automaticReconnectionTimeout: settings.automaticReconnectionTimeout,
      initialRevisionList: [],
      initialOptions: {},
      savedRevisions: pad.getSavedRevisions(),
      collab_client_vars: {
        initialAttributedText: atext,
        clientIp: '127.0.0.1',
        padId: sessionInfo.auth.padID,
        historicalAuthorData,
        apool,
        rev: pad.getHeadRevisionNumber(),
        time: currentTime,
      },
      colorPalette: authorManager.getColorPalette(),
      clientIp: '127.0.0.1',
      userColor: authorColorId,
      padId: sessionInfo.auth.padID,
      padOptions: settings.padOptions,
      padShortcutEnabled: settings.padShortcutEnabled,
      initialTitle: `Pad: ${sessionInfo.auth.padID}`,
      opts: {},
      // tell the client the number of the latest chat-message, which will be
      // used to request the latest 100 chat-messages later (GET_CHAT_MESSAGES)
      chatHead: pad.chatHead,
      numConnectedUsers: roomSockets.length,
      readOnlyId: sessionInfo.readOnlyPadId,
      readonly: sessionInfo.readonly,
      serverTimestamp: Date.now(),
      sessionRefreshInterval: settings.cookie.sessionRefreshInterval,
      userId: sessionInfo.author,
      abiwordAvailable: abiwordAvailable(),
      sofficeAvailable: sofficeAvailable(),
      exportAvailable: exportAvailable(),
      plugins: {
        plugins: plugins.plugins,
        parts: plugins.parts,
      },
      indentationOnNewLine: settings.indentationOnNewLine,
      scrollWhenFocusLineIsOutOfViewport: {
        percentage: {
          editionAboveViewport:
              settings.scrollWhenFocusLineIsOutOfViewport.percentage.editionAboveViewport,
          editionBelowViewport:
              settings.scrollWhenFocusLineIsOutOfViewport.percentage.editionBelowViewport,
        },
        duration: settings.scrollWhenFocusLineIsOutOfViewport.duration,
        scrollWhenCaretIsInTheLastLineOfViewport:
            settings.scrollWhenFocusLineIsOutOfViewport.scrollWhenCaretIsInTheLastLineOfViewport,
        percentageToScrollWhenUserPressesArrowUp:
            settings.scrollWhenFocusLineIsOutOfViewport.percentageToScrollWhenUserPressesArrowUp,
      },
      initialChangesets: [], // FIXME: REMOVE THIS SHIT,
      mode: process.env.NODE_ENV
    };

    // Add a username to the clientVars if one avaiable
    if (authorName != null) {
      clientVars.userName = authorName;
    }

    // call the clientVars-hook so plugins can modify them before they get sent to the client
    const messages = await hooks.aCallAll('clientVars', {clientVars, pad, socket});

    // combine our old object with the new attributes from the hook
    for (const msg of messages) {
      Object.assign(clientVars, msg);
    }

    // Join the pad and start receiving updates
    socket.join(sessionInfo.padId);

    // Send the clientVars to the Client
    socket.emit('message', {type: 'CLIENT_VARS', data: clientVars});

    // Save the current revision in sessioninfos, should be the same as in clientVars
    sessionInfo.rev = pad.getHeadRevisionNumber();
  }

  // Notify other users about this new user.
  socket.broadcast.to(sessionInfo.padId).emit('message', {
    type: 'COLLABROOM',
    data: {
      type: 'USER_NEWINFO',
      userInfo: {
        colorId: authorColorId,
        name: authorName,
        userId: sessionInfo.author,
      },
    },
  });

  // Notify this new user about other users.
  await Promise.all(_getRoomSockets(pad.id).map(async (roomSocket) => {
    if (roomSocket.id === socket.id) return;

    // sessioninfos might change while enumerating, so check if the sessionID is still assigned to a
    // valid session.
    const sessionInfo = sessioninfos[roomSocket.id];
    if (sessionInfo == null) return;

    // get the authorname & colorId
    const authorId = sessionInfo.author;
    // The authorId of this other user might be unknown if the other user just connected and has
    // not yet sent a CLIENT_READY message.
    if (authorId == null) return;

    // reuse previously created cache of author's data
    const authorInfo = historicalAuthorData[authorId] || await authorManager.getAuthor(authorId);
    if (authorInfo == null) {
      messageLogger.error(
          `Author ${authorId} connected via socket.io session ${roomSocket.id} is missing from ` +
            'the global author database. This should never happen because the author ID is ' +
            'generated by the same code that adds the author to the database.');
      // Don't bother telling the new user about this mystery author.
      return;
    }

    const msg = {
      type: 'COLLABROOM',
      data: {
        type: 'USER_NEWINFO',
        userInfo: {
          colorId: authorInfo.colorId,
          name: authorInfo.name,
          userId: authorId,
        },
      },
    };

    socket.emit('message', msg);
  }));

  await hooks.aCallAll('userJoin', {
    authorId: sessionInfo.author,
    displayName: authorName,
    padId: sessionInfo.padId,
    readOnly: sessionInfo.readonly,
    readOnlyPadId: sessionInfo.readOnlyPadId,
    socket,
  });
};

/**
 * Handles a request for a rough changeset, the timeslider client needs it
 */
const handleChangesetRequest = async (socket:any, {data: {granularity, start, requestID}}: ChangesetRequest) => {
  if (granularity == null) throw new Error('missing granularity');
  if (!Number.isInteger(granularity)) throw new Error('granularity is not an integer');
  if (start == null) throw new Error('missing start');
  start = checkValidRev(start);
  if (requestID == null) throw new Error('mising requestID');
  const end = start + (100 * granularity);
  const {padId, author: authorId} = sessioninfos[socket.id];
  const pad = await padManager.getPad(padId, null, authorId);
  const headRev = pad.getHeadRevisionNumber();
  if (start > headRev)
    start = headRev;
  const data:MapArrayType<any> = await getChangesetInfo(pad, start, end, granularity);
  data.requestID = requestID;
  socket.emit('message', {type: 'CHANGESET_REQ', data});
};

/**
 * Tries to rebuild the getChangestInfo function of the original Etherpad
 * https://github.com/ether/pad/blob/master/etherpad/src/etherpad/control/pad/pad_changeset_control.js#L144
 */
const getChangesetInfo = async (pad: PadType, startNum: number, endNum:number, granularity: number) => {
  const headRevision = pad.getHeadRevisionNumber();

  // calculate the last full endnum
  if (endNum > headRevision + 1) endNum = headRevision + 1;
  endNum = Math.floor(endNum / granularity) * granularity;

  const compositesChangesetNeeded = [];
  const revTimesNeeded = [];

  // figure out which composite Changeset and revTimes we need, to load them in bulk
  for (let start = startNum; start < endNum; start += granularity) {
    const end = start + granularity;

    // add the composite Changeset we needed
    compositesChangesetNeeded.push({start, end});

    // add the t1 time we need
    revTimesNeeded.push(start === 0 ? 0 : start - 1);

    // add the t2 time we need
    revTimesNeeded.push(end - 1);
  }

  // Get all needed db values in parallel.
  const composedChangesets:MapArrayType<any> = {};
  const revisionDate:number[] = [];
  const [lines] = await Promise.all([
    getPadLines(pad, startNum - 1),
    // Get all needed composite Changesets.
    ...compositesChangesetNeeded.map(async (item) => {
      const changeset = await exports.composePadChangesets(pad, item.start, item.end);
      composedChangesets[`${item.start}/${item.end}`] = changeset;
    }),
    // Get all needed revision Dates.
    ...revTimesNeeded.map(async (revNum) => {
      const revDate = await pad.getRevisionDate(revNum);
      revisionDate[revNum] = revDate;
    }),
  ]);

  // doesn't know what happens here exactly :/
  const timeDeltas = [];
  const forwardsChangesets = [];
  const backwardsChangesets = [];
  const apool = new AttributePool();

  for (let compositeStart = startNum; compositeStart < endNum; compositeStart += granularity) {
    const compositeEnd = compositeStart + granularity;
    if (compositeEnd > endNum || compositeEnd > headRevision + 1) break;

    const forwards = composedChangesets[`${compositeStart}/${compositeEnd}`];
    const backwards = inverse(forwards, lines.textlines, lines.alines, pad.apool());

    mutateAttributionLines(forwards, lines.alines, pad.apool());
    mutateTextLines(forwards, lines.textlines);

    const forwards2 = moveOpsToNewPool(forwards, pad.apool(), apool);
    const backwards2 = moveOpsToNewPool(backwards, pad.apool(), apool);

    const t1 = (compositeStart === 0) ? revisionDate[0] : revisionDate[compositeStart - 1];
    const t2 = revisionDate[compositeEnd - 1];

    timeDeltas.push(t2 - t1);
    forwardsChangesets.push(forwards2);
    backwardsChangesets.push(backwards2);
  }

  return {forwardsChangesets, backwardsChangesets,
    apool: apool.toJsonable(), actualEndNum: endNum,
    timeDeltas, start: startNum, granularity};
};

/**
 * Tries to rebuild the getPadLines function of the original Etherpad
 * https://github.com/ether/pad/blob/master/etherpad/src/etherpad/control/pad/pad_changeset_control.js#L263
 */
const getPadLines = async (pad: PadType, revNum: number) => {
  // get the atext
  let atext;

  if (revNum >= 0) {
    atext = await pad.getInternalRevisionAText(revNum);
  } else {
    atext = makeAText('\n');
  }

  return {
    textlines: splitTextLines(atext.text),
    alines: splitAttributionLines(atext.attribs, atext.text),
  };
};

/**
 * Tries to rebuild the composePadChangeset function of the original Etherpad
 * https://github.com/ether/pad/blob/master/etherpad/src/etherpad/control/pad/pad_changeset_control.js#L241
 */
exports.composePadChangesets = async (pad: PadType, startNum: number, endNum: number) => {
  // fetch all changesets we need
  const headNum = pad.getHeadRevisionNumber();
  endNum = Math.min(endNum, headNum + 1);
  startNum = Math.max(startNum, 0);

  // create an array for all changesets, we will
  // replace the values with the changeset later
  const changesetsNeeded = [];
  for (let r = startNum; r < endNum; r++) {
    changesetsNeeded.push(r);
  }

  // get all changesets
  const changesets:MapArrayType<ChangeSet> = {};
  await Promise.all(changesetsNeeded.map(
      (revNum) => pad.getRevisionChangeset(revNum)
          .then((changeset) => changesets[revNum] = changeset)));

  // compose Changesets
  let r;
  try {
    let changeset = changesets[startNum];
    const pool = pad.apool();

    for (r = startNum + 1; r < endNum; r++) {
      const cs = changesets[r];
      changeset = compose(changeset as string, cs as string, pool);
    }
    return changeset;
  } catch (e) {
    // r-1 indicates the rev that was build starting with startNum, applying startNum+1, +2, +3
    messageLogger.warn(
        `failed to compose cs in pad: ${pad.id} startrev: ${startNum} current rev: ${r}`);
    throw e;
  }
};

const _getRoomSockets = (padID: string) => {
  const ns = socketio.sockets; // Default namespace.
  // We could call adapter.clients(), but that method is unnecessarily asynchronous. Replicate what
  // it does here, but synchronously to avoid a race condition. This code will have to change when
  // we update to socket.io v3.
  const room = ns.adapter.rooms?.get(padID);

  if (!room) return [];

  return Array.from(room)
    .map(socketId => ns.sockets.get(socketId))
    .filter(socket => socket);
};

/**
 * Get the number of users in a pad
 */
exports.padUsersCount = (padID:string) => ({
  padUsersCount: _getRoomSockets(padID).length,
});

/**
 * Get the list of users in a pad
 */
exports.padUsers = async (padID: string) => {
  const padUsers:PadAuthor[] = [];

  // iterate over all clients (in parallel)
  await Promise.all(_getRoomSockets(padID).map(async (roomSocket) => {
    const s = sessioninfos[roomSocket.id];
    if (s) {
      const author = await authorManager.getAuthor(s.author);
      // Fixes: https://github.com/ether/etherpad-lite/issues/4120
      // On restart author might not be populated?
      if (author) {
        author.id = s.author;
        padUsers.push(author);
      }
    }
  }));

  return {padUsers};
};

exports.sessioninfos = sessioninfos;
