'use strict';
/**
 * This module provides all API functions
 */

/*
 * 2011 Peter 'Pita' Martischka (Primary Technology Ltd)
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

import {deserializeOps} from '../../static/js/Changeset';
import ChatMessage from '../../static/js/ChatMessage';
import {Builder} from "../../static/js/Builder";
import {Attribute} from "../../static/js/types/Attribute";
const CustomError = require('../utils/customError');
const padManager = require('./PadManager');
const padMessageHandler = require('../handler/PadMessageHandler');
import readOnlyManager from './ReadOnlyManager';
const groupManager = require('./GroupManager');
const authorManager = require('./AuthorManager');
const sessionManager = require('./SessionManager');
const exportHtml = require('../utils/ExportHtml');
const exportTxt = require('../utils/ExportTxt');
const importHtml = require('../utils/ImportHtml');
const cleanText = require('./Pad').cleanText;
const PadDiff = require('../utils/padDiff');
const {checkValidRev, isInt} = require('../utils/checkValidRev');

/* ********************
 * GROUP FUNCTIONS ****
 ******************** */

exports.listAllGroups = groupManager.listAllGroups;
exports.createGroup = groupManager.createGroup;
exports.createGroupIfNotExistsFor = groupManager.createGroupIfNotExistsFor;
exports.deleteGroup = groupManager.deleteGroup;
exports.listPads = groupManager.listPads;
exports.createGroupPad = groupManager.createGroupPad;

/* ********************
 * PADLIST FUNCTION ***
 ******************** */

exports.listAllPads = padManager.listAllPads;

/* ********************
 * AUTHOR FUNCTIONS ***
 ******************** */

exports.createAuthor = authorManager.createAuthor;
exports.createAuthorIfNotExistsFor = authorManager.createAuthorIfNotExistsFor;
exports.getAuthorName = authorManager.getAuthorName;
exports.listPadsOfAuthor = authorManager.listPadsOfAuthor;
exports.padUsers = padMessageHandler.padUsers;
exports.padUsersCount = padMessageHandler.padUsersCount;

/* ********************
 * SESSION FUNCTIONS **
 ******************** */

exports.createSession = sessionManager.createSession;
exports.deleteSession = sessionManager.deleteSession;
exports.getSessionInfo = sessionManager.getSessionInfo;
exports.listSessionsOfGroup = sessionManager.listSessionsOfGroup;
exports.listSessionsOfAuthor = sessionManager.listSessionsOfAuthor;

/* ***********************
 * PAD CONTENT FUNCTIONS *
 *********************** */

/**
getAttributePool(padID) returns the attribute pool of a pad

Example returns:
{
 "code":0,
 "message":"ok",
 "data": {
    "pool":{
        "numToAttrib":{
            "0":["author","a.X4m8bBWJBZJnWGSh"],
            "1":["author","a.TotfBPzov54ihMdH"],
            "2":["author","a.StiblqrzgeNTbK05"],
            "3":["bold","true"]
        },
        "attribToNum":{
            "author,a.X4m8bBWJBZJnWGSh":0,
            "author,a.TotfBPzov54ihMdH":1,
            "author,a.StiblqrzgeNTbK05":2,
            "bold,true":3
        },
        "nextNum":4
    }
 }
}

*/
exports.getAttributePool = async (padID: string) => {
  const pad = await getPadSafe(padID, true);
  return {pool: pad.pool};
};

/**
getRevisionChangeset (padID, [rev])

get the changeset at a given revision, or last revision if 'rev' is not defined.

Example returns:
{
    "code" : 0,
    "message" : "ok",
    "data" : "Z:1>6b|5+6b$Welcome to Etherpad!\n\nThis pad text is synchronized as you type, so that everyone viewing this page sees the same text. This allows you to collaborate seamlessly on documents!\n\nGet involved with Etherpad at http://etherpad.org\n"
}

*/
exports.getRevisionChangeset = async (padID: string, rev: string) => {
  // try to parse the revision number
  if (rev !== undefined) {
    rev = checkValidRev(rev);
  }

  // get the pad
  const pad = await getPadSafe(padID, true);
  const head = pad.getHeadRevisionNumber();

  // the client asked for a special revision
  if (rev !== undefined) {
    // check if this is a valid revision
    if (rev > head) {
      throw new CustomError('rev is higher than the head revision of the pad', 'apierror');
    }

    // get the changeset for this revision
    return await pad.getRevisionChangeset(rev);
  }

  // the client wants the latest changeset, lets return it to him
  return await pad.getRevisionChangeset(head);
};

/**
getText(padID, [rev]) returns the text of a pad

Example returns:

{code: 0, message:"ok", data: {text:"Welcome Text"}}
{code: 1, message:"padID does not exist", data: null}
*/
exports.getText = async (padID: string, rev: string) => {
  // try to parse the revision number
  if (rev !== undefined) {
    rev = checkValidRev(rev);
  }

  // get the pad
  const pad = await getPadSafe(padID, true);
  const head = pad.getHeadRevisionNumber();

  // the client asked for a special revision
  if (rev !== undefined) {
    // check if this is a valid revision
    if (rev > head) {
      throw new CustomError('rev is higher than the head revision of the pad', 'apierror');
    }

    // get the text of this revision
    // getInternalRevisionAText() returns an atext object, but we only want the .text inside it.
    // Details at https://github.com/ether/etherpad-lite/issues/5073
    const {text} = await pad.getInternalRevisionAText(rev);
    return {text};
  }

  // the client wants the latest text, lets return it to him
  const text = exportTxt.getTXTFromAtext(pad, pad.atext);
  return {text};
};

/**
setText(padID, text, [authorId]) sets the text of a pad

Example returns:

{code: 0, message:"ok", data: null}
{code: 1, message:"padID does not exist", data: null}
{code: 1, message:"text too long", data: null}
*/
/**
 *
 * @param {String} padID the id of the pad
 * @param {String} text the text of the pad
 * @param {String} authorId the id of the author, defaulting to empty string
 * @returns {Promise<void>}
 */
exports.setText = async (padID: string, text?: string, authorId: string = ''): Promise<void> => {
  // text is required
  if (typeof text !== 'string') {
    throw new CustomError('text is not a string', 'apierror');
  }

  // get the pad
  const pad = await getPadSafe(padID, true);

  await pad.setText(text, authorId);
  await padMessageHandler.updatePadClients(pad);
};

/**
appendText(padID, text, [authorId]) appends text to a pad

Example returns:

{code: 0, message:"ok", data: null}
{code: 1, message:"padID does not exist", data: null}
{code: 1, message:"text too long", data: null}
 @param {String} padID the id of the pad
 @param {String} text the text of the pad
 @param {String} authorId the id of the author, defaulting to empty string
 */
exports.appendText = async (padID:string, text?: string, authorId:string = '') => {
  // text is required
  if (typeof text !== 'string') {
    throw new CustomError('text is not a string', 'apierror');
  }

  const pad = await getPadSafe(padID, true);
  await pad.appendText(text, authorId);
  await padMessageHandler.updatePadClients(pad);
};

/**
getHTML(padID, [rev]) returns the html of a pad

Example returns:

{code: 0, message:"ok", data: {text:"Welcome <strong>Text</strong>"}}
{code: 1, message:"padID does not exist", data: null}
 @param {String} padID the id of the pad
 @param {String} rev the revision number, defaulting to the latest revision
 @return {Promise<{html: string}>} the html of the pad
*/
exports.getHTML = async (padID: string, rev: string): Promise<{ html: string; }> => {
  if (rev !== undefined) {
    rev = checkValidRev(rev);
  }

  const pad = await getPadSafe(padID, true);

  // the client asked for a special revision
  if (rev !== undefined) {
    // check if this is a valid revision
    const head = pad.getHeadRevisionNumber();
    if (rev > head) {
      throw new CustomError('rev is higher than the head revision of the pad', 'apierror');
    }
  }

  // get the html of this revision
  let html = await exportHtml.getPadHTML(pad, rev);

  // wrap the HTML
  html = `<!DOCTYPE HTML><html><body>${html}</body></html>`;
  return {html};
};

/**
setHTML(padID, html, [authorId]) sets the text of a pad based on HTML

Example returns:

{code: 0, message:"ok", data: null}
{code: 1, message:"padID does not exist", data: null}

 @param {String} padID the id of the pad
 @param {String} html the html of the pad
 @param {String} authorId the id of the author, defaulting to empty string
*/
exports.setHTML = async (padID: string, html:string|object, authorId = '') => {
  // html string is required
  if (typeof html !== 'string') {
    throw new CustomError('html is not a string', 'apierror');
  }

  // get the pad
  const pad = await getPadSafe(padID, true);

  // add a new changeset with the new html to the pad
  try {
    await importHtml.setPadHTML(pad, cleanText(html), authorId);
  } catch (e) {
    throw new CustomError('HTML is malformed', 'apierror');
  }

  // update the clients on the pad
  padMessageHandler.updatePadClients(pad);
};

/* ****************
 * CHAT FUNCTIONS *
 **************** */

/**
getChatHistory(padId, start, end), returns a part of or the whole chat-history of this pad

Example returns:

{"code":0,"message":"ok","data":{"messages":[
  {"text":"foo","authorID":"a.foo","time":1359199533759,"userName":"test"},
  {"text":"bar","authorID":"a.foo","time":1359199534622,"userName":"test"}
]}}

{code: 1, message:"start is higher or equal to the current chatHead", data: null}

{code: 1, message:"padID does not exist", data: null}
 @param {String} padID the id of the pad
 @param {Number} start the start point of the chat-history
 @param {Number} end the end point of the chat-history
*/
exports.getChatHistory = async (padID: string, start:number, end:number) => {
  if (start && end) {
    if (start < 0) {
      throw new CustomError('start is below zero', 'apierror');
    }
    if (end < 0) {
      throw new CustomError('end is below zero', 'apierror');
    }
    if (start > end) {
      throw new CustomError('start is higher than end', 'apierror');
    }
  }

  // get the pad
  const pad = await getPadSafe(padID, true);

  const chatHead = pad.chatHead;

  // fall back to getting the whole chat-history if a parameter is missing
  if (!start || !end) {
    start = 0;
    end = pad.chatHead;
  }

  if (start > chatHead) {
    throw new CustomError('start is higher than the current chatHead', 'apierror');
  }
  if (end > chatHead) {
    throw new CustomError('end is higher than the current chatHead', 'apierror');
  }

  // the whole message-log and return it to the client
  const messages = await pad.getChatMessages(start, end);

  return {messages};
};

/**
appendChatMessage(padID, text, authorID, time), creates a chat message for the pad id,
time is a timestamp

Example returns:

{code: 0, message:"ok", data: null}
{code: 1, message:"padID does not exist", data: null}
 @param {String} padID the id of the pad
 @param {String} text the text of the chat-message
 @param {String} authorID the id of the author
 @param {Number} time the timestamp of the chat-message
*/
exports.appendChatMessage = async (padID: string, text: string|object, authorID: string, time: number) => {
  // text is required
  if (typeof text !== 'string') {
    throw new CustomError('text is not a string', 'apierror');
  }

  // if time is not an integer value set time to current timestamp
  if (time === undefined || !isInt(time)) {
    time = Date.now();
  }

  // @TODO - missing getPadSafe() call ?

  // save chat message to database and send message to all connected clients
  await padMessageHandler.sendChatMessageToPadClients(new ChatMessage(text, authorID, time), padID);
};

/* ***************
 * PAD FUNCTIONS *
 *************** */

/**
getRevisionsCount(padID) returns the number of revisions of this pad

Example returns:

{code: 0, message:"ok", data: {revisions: 56}}
{code: 1, message:"padID does not exist", data: null}
 @param {String} padID the id of the pad
*/
exports.getRevisionsCount = async (padID: string) => {
  // get the pad
  const pad = await getPadSafe(padID, true);
  return {revisions: pad.getHeadRevisionNumber()};
};

/**
getSavedRevisionsCount(padID) returns the number of saved revisions of this pad

Example returns:

{code: 0, message:"ok", data: {savedRevisions: 42}}
{code: 1, message:"padID does not exist", data: null}
 @param {String} padID the id of the pad
*/
exports.getSavedRevisionsCount = async (padID: string) => {
  // get the pad
  const pad = await getPadSafe(padID, true);
  return {savedRevisions: pad.getSavedRevisionsNumber()};
};

/**
listSavedRevisions(padID) returns the list of saved revisions of this pad

Example returns:

{code: 0, message:"ok", data: {savedRevisions: [2, 42, 1337]}}
{code: 1, message:"padID does not exist", data: null}
 @param {String} padID the id of the pad
*/
exports.listSavedRevisions = async (padID: string) => {
  // get the pad
  const pad = await getPadSafe(padID, true);
  return {savedRevisions: pad.getSavedRevisionsList()};
};

/**
saveRevision(padID) returns the list of saved revisions of this pad

Example returns:

{code: 0, message:"ok", data: null}
{code: 1, message:"padID does not exist", data: null}
    @param {String} padID the id of the pad
     @param {Number} rev the revision number, defaulting to the latest revision
*/
exports.saveRevision = async (padID: string, rev: number) => {
  // check if rev is a number
  if (rev !== undefined) {
    rev = checkValidRev(rev);
  }

  // get the pad
  const pad = await getPadSafe(padID, true);
  const head = pad.getHeadRevisionNumber();

  // the client asked for a special revision
  if (rev !== undefined) {
    if (rev > head) {
      throw new CustomError('rev is higher than the head revision of the pad', 'apierror');
    }
  } else {
    rev = pad.getHeadRevisionNumber();
  }

  const author = await authorManager.createAuthor('API');
  await pad.addSavedRevision(rev, author.authorID, 'Saved through API call');
};

/**
getLastEdited(padID) returns the timestamp of the last revision of the pad

Example returns:

{code: 0, message:"ok", data: {lastEdited: 1340815946602}}
{code: 1, message:"padID does not exist", data: null}
    @param {String} padID the id of the pad
 @return {Promise<{lastEdited: number}>} the timestamp of the last revision of the pad
*/
exports.getLastEdited = async (padID: string): Promise<{ lastEdited: number; }> => {
  // get the pad
  const pad = await getPadSafe(padID, true);
  const lastEdited = await pad.getLastEdit();
  return {lastEdited};
};

/**
createPad(padName, [text], [authorId]) creates a new pad in this group

Example returns:

{code: 0, message:"ok", data: null}
{code: 1, message:"pad does already exist", data: null}
 @param {String} padID the name of the new pad
    @param {String} text the initial text of the pad
     @param {String} authorId the id of the author, defaulting to empty string
*/
exports.createPad = async (padID: string, text: string, authorId = '') => {
  if (padID) {
    // ensure there is no $ in the padID
    if (padID.indexOf('$') !== -1) {
      throw new CustomError("createPad can't create group pads", 'apierror');
    }

    // check for url special characters
    if (padID.match(/(\/|\?|&|#)/)) {
      throw new CustomError('malformed padID: Remove special characters', 'apierror');
    }
  }

  // create pad
  await getPadSafe(padID, false, text, authorId);
};

/**
deletePad(padID) deletes a pad

Example returns:

{code: 0, message:"ok", data: null}
{code: 1, message:"padID does not exist", data: null}
 @param {String} padID the id of the pad
*/
exports.deletePad = async (padID: string) => {
  const pad = await getPadSafe(padID, true);
  await pad.remove();
};

/**
 restoreRevision(padID, rev, [authorId]) Restores revision from past as new changeset

 Example returns:

 {code:0, message:"ok", data:null}
 {code: 1, message:"padID does not exist", data: null}
 @param {String} padID the id of the pad
 @param {Number} rev the revision number, defaulting to the latest revision
 @param {String} authorId the id of the author, defaulting to empty string
 */
exports.restoreRevision = async (padID: string, rev: number, authorId = '') => {
  // check if rev is a number
  if (rev === undefined) {
    throw new CustomError('rev is not defined', 'apierror');
  }
  rev = checkValidRev(rev);

  // get the pad
  const pad = await getPadSafe(padID, true);

  // check if this is a valid revision
  if (rev > pad.getHeadRevisionNumber()) {
    throw new CustomError('rev is higher than the head revision of the pad', 'apierror');
  }

  const atext = await pad.getInternalRevisionAText(rev);

  const oldText = pad.text();
  atext.text += '\n';

  const eachAttribRun = (attribs: string, func:Function) => {
    let textIndex = 0;
    const newTextStart = 0;
    const newTextEnd = atext.text.length;
    for (const op of deserializeOps(attribs)) {
      const nextIndex = textIndex + op.chars;
      if (!(nextIndex <= newTextStart || textIndex >= newTextEnd)) {
        func(Math.max(newTextStart, textIndex), Math.min(newTextEnd, nextIndex), op.attribs);
      }
      textIndex = nextIndex;
    }
  };

  // create a new changeset with a helper builder object
  const builder = new Builder(oldText.length);

  // assemble each line into the builder
  eachAttribRun(atext.attribs, (start: number, end: number, attribs:Attribute[]) => {
    builder.insert(atext.text.substring(start, end), attribs);
  });

  const lastNewlinePos = oldText.lastIndexOf('\n');
  if (lastNewlinePos < 0) {
    builder.remove(oldText.length - 1, 0);
  } else {
    builder.remove(lastNewlinePos, oldText.match(/\n/g).length - 1);
    builder.remove(oldText.length - lastNewlinePos - 1, 0);
  }

  const changeset = builder.toString();

  await pad.appendRevision(changeset, authorId);
  await padMessageHandler.updatePadClients(pad);
};

/**
copyPad(sourceID, destinationID[, force=false]) copies a pad. If force is true,
  the destination will be overwritten if it exists.

Example returns:

{code: 0, message:"ok", data: {padID: destinationID}}
{code: 1, message:"padID does not exist", data: null}
 @param {String} sourceID the id of the source pad
 @param {String} destinationID the id of the destination pad
 @param {Boolean} force whether to overwrite the destination pad if it exists
*/
exports.copyPad = async (sourceID: string, destinationID: string, force: boolean) => {
  const pad = await getPadSafe(sourceID, true);
  await pad.copy(destinationID, force);
};

/**
copyPadWithoutHistory(sourceID, destinationID[, force=false], [authorId]) copies a pad. If force is
true, the destination will be overwritten if it exists.

Example returns:

{code: 0, message:"ok", data: {padID: destinationID}}
{code: 1, message:"padID does not exist", data: null}
 @param {String} sourceID the id of the source pad
 @param {String} destinationID the id of the destination pad
 @param {Boolean} force whether to overwrite the destination pad if it exists
 @param {String} authorId the id of the author, defaulting to empty string
*/
exports.copyPadWithoutHistory = async (sourceID: string, destinationID: string, force:boolean, authorId = '') => {
  const pad = await getPadSafe(sourceID, true);
  await pad.copyPadWithoutHistory(destinationID, force, authorId);
};

/**
movePad(sourceID, destinationID[, force=false]) moves a pad. If force is true,
  the destination will be overwritten if it exists.

Example returns:

{code: 0, message:"ok", data: {padID: destinationID}}
{code: 1, message:"padID does not exist", data: null}
 @param {String} sourceID the id of the source pad
 @param {String} destinationID the id of the destination pad
 @param {Boolean} force whether to overwrite the destination pad if it exists
*/
exports.movePad = async (sourceID: string, destinationID: string, force:boolean) => {
  const pad = await getPadSafe(sourceID, true);
  await pad.copy(destinationID, force);
  await pad.remove();
};

/**
getReadOnlyLink(padID) returns the read only link of a pad

Example returns:

{code: 0, message:"ok", data: null}
{code: 1, message:"padID does not exist", data: null}
 @param {String} padID the id of the pad
*/
exports.getReadOnlyID = async (padID: string) => {
  // we don't need the pad object, but this function does all the security stuff for us
  await getPadSafe(padID, true);

  // get the readonlyId
  const readOnlyID = await readOnlyManager.getReadOnlyId(padID);

  return {readOnlyID};
};

/**
getPadID(roID) returns the padID of a pad based on the readonlyID(roID)

Example returns:

{code: 0, message:"ok", data: {padID: padID}}
{code: 1, message:"padID does not exist", data: null}
    @param {String} roID the readonly id of the pad
*/
exports.getPadID = async (roID: string) => {
  // get the PadId
  const padID = await readOnlyManager.getPadId(roID);
  if (padID == null) {
    throw new CustomError('padID does not exist', 'apierror');
  }

  return {padID};
};

/**
setPublicStatus(padID, publicStatus) sets a boolean for the public status of a pad

Example returns:

{code: 0, message:"ok", data: null}
{code: 1, message:"padID does not exist", data: null}
    @param {String} padID the id of the pad
     @param {Boolean} publicStatus the public status of the pad
*/
exports.setPublicStatus = async (padID: string, publicStatus: boolean|string) => {
  // ensure this is a group pad
  checkGroupPad(padID, 'publicStatus');

  // get the pad
  const pad = await getPadSafe(padID, true);

  // convert string to boolean
  if (typeof publicStatus === 'string') {
    publicStatus = (publicStatus.toLowerCase() === 'true');
  }

  await pad.setPublicStatus(publicStatus);
};

/**
getPublicStatus(padID) return true of false

Example returns:

{code: 0, message:"ok", data: {publicStatus: true}}
{code: 1, message:"padID does not exist", data: null}
     @param {String} padID the id of the pad
*/
exports.getPublicStatus = async (padID: string) => {
  // ensure this is a group pad
  checkGroupPad(padID, 'publicStatus');

  // get the pad
  const pad = await getPadSafe(padID, true);
  return {publicStatus: pad.getPublicStatus()};
};

/**
listAuthorsOfPad(padID) returns an array of authors who contributed to this pad

Example returns:

{code: 0, message:"ok", data: {authorIDs : ["a.s8oes9dhwrvt0zif", "a.akf8finncvomlqva"]}
{code: 1, message:"padID does not exist", data: null}
     @param {String} padID the id of the pad
*/
exports.listAuthorsOfPad = async (padID: string) => {
  // get the pad
  const pad = await getPadSafe(padID, true);
  const authorIDs = pad.getAllAuthors();
  return {authorIDs};
};

/**
sendClientsMessage(padID, msg) sends a message to all clients connected to the
pad, possibly for the purpose of signalling a plugin.

Note, this will only accept strings from the HTTP API, so sending bogus changes
or chat messages will probably not be possible.

The resulting message will be structured like so:

{
  type: 'COLLABROOM',
  data: {
    type: <msg>,
    time: <time the message was sent>
  }
}

Example returns:

{code: 0, message:"ok"}
{code: 1, message:"padID does not exist"}
     @param {String} padID the id of the pad
     @param {String} msg the message to send
*/

exports.sendClientsMessage = async (padID: string, msg: string) => {
  await getPadSafe(padID, true); // Throw if the padID is invalid or if the pad does not exist.
  padMessageHandler.handleCustomMessage(padID, msg);
};

/**
checkToken() returns ok when the current api token is valid

Example returns:

{"code":0,"message":"ok","data":null}
{"code":4,"message":"no or wrong API Key","data":null}
*/
exports.checkToken = async () => {
};

/**
getChatHead(padID) returns the chatHead (last number of the last chat-message) of the pad

Example returns:

{code: 0, message:"ok", data: {chatHead: 42}}
{code: 1, message:"padID does not exist", data: null}
     @param {String} padID the id of the pad
     @return {Promise<{chatHead: number}>} the chatHead of the pad
*/
exports.getChatHead = async (padID:string): Promise<{ chatHead: number; }> => {
  // get the pad
  const pad = await getPadSafe(padID, true);
  return {chatHead: pad.chatHead};
};

/**
createDiffHTML(padID, startRev, endRev) returns an object of diffs from 2 points in a pad

Example returns:
{
  "code": 0,
  "message": "ok",
  "data": {
    "html": "...",
    "authors": [
      "a.HKIv23mEbachFYfH",
      ""
    ]
  }
}
{"code":4,"message":"no or wrong API Key","data":null}
  @param {String} padID the id of the pad
 @param {Number} startRev the start revision number
 @param {Number} endRev the end revision number
*/
exports.createDiffHTML = async (padID: string, startRev: number, endRev: number) => {
  // check if startRev is a number
  if (startRev !== undefined) {
    startRev = checkValidRev(startRev);
  }

  // check if endRev is a number
  if (endRev !== undefined) {
    endRev = checkValidRev(endRev);
  }

  // get the pad
  const pad = await getPadSafe(padID, true);
  const headRev = pad.getHeadRevisionNumber();
  if (startRev > headRev) startRev = headRev;

  if (endRev > headRev) endRev = headRev;

  let padDiff;
  try {
    padDiff = new PadDiff(pad, startRev, endRev);
  } catch (e:any) {
    throw {stop: e.message};
  }

  const html = await padDiff.getHtml();
  const authors = await padDiff.getAuthors();

  return {html, authors};
};

/* ********************
 ** GLOBAL FUNCTIONS **
 ******************** */

/**
 getStats() returns an json object with some instance stats

 Example returns:

 {"code":0,"message":"ok","data":{"totalPads":3,"totalSessions": 2,"totalActivePads": 1}}
 {"code":4,"message":"no or wrong API Key","data":null}
 */
exports.getStats = async () => {
  const sessionInfos = padMessageHandler.sessioninfos;

  const sessionKeys = Object.keys(sessionInfos);
  // @ts-ignore
  const activePads = new Set(Object.entries(sessionInfos).map((k) => k[1].padId));

  const {padIDs} = await padManager.listAllPads();

  return {
    totalPads: padIDs.length,
    totalSessions: sessionKeys.length,
    totalActivePads: activePads.size,
  };
};

/* ****************************
 ** INTERNAL HELPER FUNCTIONS *
 **************************** */

// gets a pad safe
const getPadSafe = async (padID: string|object, shouldExist: boolean, text?:string, authorId:string = '') => {
  // check if padID is a string
  if (typeof padID !== 'string') {
    throw new CustomError('padID is not a string', 'apierror');
  }

  // check if the padID maches the requirements
  if (!padManager.isValidPadId(padID)) {
    throw new CustomError('padID did not match requirements', 'apierror');
  }

  // check if the pad exists
  const exists = await padManager.doesPadExists(padID);

  if (!exists && shouldExist) {
    // does not exist, but should
    throw new CustomError('padID does not exist', 'apierror');
  }

  if (exists && !shouldExist) {
    // does exist, but shouldn't
    throw new CustomError('padID does already exist', 'apierror');
  }

  // pad exists, let's get it
  return padManager.getPad(padID, text, authorId);
};

// checks if a padID is part of a group
const checkGroupPad = (padID: string, field: string) => {
  // ensure this is a group pad
  if (padID && padID.indexOf('$') === -1) {
    throw new CustomError(
        `You can only get/set the ${field} of pads that belong to a group`, 'apierror');
  }
};
