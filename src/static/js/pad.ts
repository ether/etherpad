// @ts-nocheck
'use strict';
const skinVariants = require('./skin_variants');

/**
 * This code is mostly from the old Etherpad. Please help us to comment this code.
 * This helps other people to understand this code better and helps them to improve it.
 * TL;DR COMMENTS ON THIS FILE ARE HIGHLY APPRECIATED
 */

/**
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

let socket;


// These jQuery things should create local references, but for now `require()`
// assigns to the global `$` and augments it with plugins.
require('./vendors/jquery');
require('./vendors/farbtastic');
require('./vendors/gritter');

import html10n from './vendors/html10n'

import {Cookies} from "./pad_utils";

const chat = require('./chat').chat;
const getCollabClient = require('./collab_client').getCollabClient;
const padconnectionstatus = require('./pad_connectionstatus').padconnectionstatus;
const padcookie = require('./pad_cookie').padcookie;
const padeditbar = require('./pad_editbar').padeditbar;
const padeditor = require('./pad_editor').padeditor;
const padimpexp = require('./pad_impexp').padimpexp;
const padmodals = require('./pad_modals').padmodals;
const padsavedrevs = require('./pad_savedrevs');
const paduserlist = require('./pad_userlist').paduserlist;
import padutils from './pad_utils'
const colorutils = require('./colorutils').colorutils;
import {randomString} from "./pad_utils";
const socketio = require('./socketio');

const hooks = require('./pluginfw/hooks');

// This array represents all GET-parameters which can be used to change a setting.
//   name:     the parameter-name, eg  `?noColors=true`  =>  `noColors`
//   checkVal: the callback is only executed when
//                * the parameter was supplied and matches checkVal
//                * the parameter was supplied and checkVal is null
//   callback: the function to call when all above succeeds, `val` is the value supplied by the user
const getParameters = [
  {
    name: 'noColors',
    checkVal: 'true',
    callback: (val) => {
      settings.noColors = true;
      $('#clearAuthorship').hide();
    },
  },
  {
    name: 'showControls',
    checkVal: 'true',
    callback: (val) => {
      $('#editbar').css('display', 'flex');
    },
  },
  {
    name: 'showChat',
    checkVal: null,
    callback: (val) => {
      if (val === 'false') {
        settings.hideChat = true;
        chat.hide();
        $('#chaticon').hide();
      }
    },
  },
  {
    name: 'showLineNumbers',
    checkVal: 'false',
    callback: (val) => {
      settings.LineNumbersDisabled = true;
    },
  },
  {
    name: 'useMonospaceFont',
    checkVal: 'true',
    callback: (val) => {
      settings.useMonospaceFontGlobal = true;
    },
  },
  {
    name: 'userName',
    checkVal: null,
    callback: (val) => {
      settings.globalUserName = val;
      clientVars.userName = val;
    },
  },
  {
    name: 'userColor',
    checkVal: null,
    callback: (val) => {
      settings.globalUserColor = val;
      clientVars.userColor = val;
    },
  },
  {
    name: 'rtl',
    checkVal: 'true',
    callback: (val) => {
      settings.rtlIsTrue = true;
    },
  },
  {
    name: 'alwaysShowChat',
    checkVal: 'true',
    callback: (val) => {
      if (!settings.hideChat) chat.stickToScreen();
    },
  },
  {
    name: 'chatAndUsers',
    checkVal: 'true',
    callback: (val) => {
      chat.chatAndUsers();
    },
  },
  {
    name: 'lang',
    checkVal: null,
    callback: (val) => {
      console.log('Val is', val)
      html10n.localize([val, 'en']);
      Cookies.set('language', val);
    },
  },
];

const getParams = () => {
  // Tries server enforced options first..
  for (const setting of getParameters) {
    let value = clientVars.padOptions[setting.name];
    if (value == null) continue;
    value = value.toString();
    if (value === setting.checkVal || setting.checkVal == null) {
      setting.callback(value);
    }
  }

  // Then URL applied stuff
  const params = getUrlVars();
  for (const setting of getParameters) {
    const value = params.get(setting.name);
    if (value && (value === setting.checkVal || setting.checkVal == null)) {
      setting.callback(value);
    }
  }
};

const getUrlVars = () => new URL(window.location.href).searchParams;

const sendClientReady = (isReconnect) => {
  let padId = document.location.pathname.substring(document.location.pathname.lastIndexOf('/') + 1);
  // unescape necessary due to Safari and Opera interpretation of spaces
  padId = decodeURIComponent(padId);

  if (!isReconnect) {
    const titleArray = document.title.split('|');
    const title = titleArray[titleArray.length - 1];
    document.title = `${padId.replace(/_+/g, ' ')} | ${title}`;
  }

  let token = Cookies.get('token');
  if (token == null || !padutils.isValidAuthorToken(token)) {
    token = padutils.generateAuthorToken();
    Cookies.set('token', token, {expires: 60});
  }

  // If known, propagate the display name and color to the server in the CLIENT_READY message. This
  // allows the server to include the values in its reply CLIENT_VARS message (which avoids
  // initialization race conditions) and in the USER_NEWINFO messages sent to the other users on the
  // pad (which enables them to display a user join notification with the correct name).
  const params = getUrlVars();
  const userInfo = {
    colorId: params.get('userColor'),
    name: params.get('userName'),
  };

  const msg = {
    component: 'pad',
    type: 'CLIENT_READY',
    padId,
    sessionID: Cookies.get('sessionID'),
    token,
    userInfo,
  };

  // this is a reconnect, lets tell the server our revisionnumber
  if (isReconnect) {
    msg.client_rev = pad.collabClient.getCurrentRevisionNumber();
    msg.reconnect = true;
  }

  socket.emit("message", msg);
};

const handshake = async () => {
  let receivedClientVars = false;
  let padId = document.location.pathname.substring(document.location.pathname.lastIndexOf('/') + 1);
  // unescape necessary due to Safari and Opera interpretation of spaces
  padId = decodeURIComponent(padId);

  // padId is used here for sharding / scaling.  We prefix the padId with padId: so it's clear
  // to the proxy/gateway/whatever that this is a pad connection and should be treated as such
  socket = pad.socket = socketio.connect(exports.baseURL, '/', {
    query: {padId},
    reconnectionAttempts: 5,
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
  });

  socket.once('connect', () => {
    sendClientReady(false);
  });

  socket.io.on('reconnect', () => {
    // pad.collabClient might be null if the hanshake failed (or it never got that far).
    if (pad.collabClient != null) {
      pad.collabClient.setChannelState('CONNECTED');
    }
    sendClientReady(receivedClientVars);
  });

  const socketReconnecting = () => {
    // pad.collabClient might be null if the hanshake failed (or it never got that far).
    if (pad.collabClient != null) {
      pad.collabClient.setStateIdle();
      pad.collabClient.setIsPendingRevision(true);
      pad.collabClient.setChannelState('RECONNECTING');
    }
  };

  socket.on('disconnect', (reason) => {
    // The socket.io client will automatically try to reconnect for all reasons other than "io
    // server disconnect".
    console.log(`Socket disconnected: ${reason}`)
    //if (reason !== 'io server disconnect' || reason !== 'ping timeout') return;
    socketReconnecting();
  });


  socket.on('shout', (obj) => {
    if(obj.type === "COLLABROOM") {
      let date = new Date(obj.data.payload.timestamp);
      $.gritter.add({
        // (string | mandatory) the heading of the notification
        title: 'Admin message',
        // (string | mandatory) the text inside the notification
        text: '[' + date.toLocaleTimeString() + ']: ' + obj.data.payload.message.message,
        // (bool | optional) if you want it to fade out on its own or just sit there
        sticky: obj.data.payload.message.sticky
      });
    }
  })

  socket.io.on('reconnect_attempt', socketReconnecting);

  socket.io.on('reconnect_failed', (error) => {
    // pad.collabClient might be null if the hanshake failed (or it never got that far).
    if (pad.collabClient != null) {
      pad.collabClient.setChannelState('DISCONNECTED', 'reconnect_timeout');
    } else {
      throw new Error('Reconnect timed out');
    }
  });


  socket.on('error', (error) => {
    // pad.collabClient might be null if the error occurred before the hanshake completed.
    if (pad.collabClient != null) {
      pad.collabClient.setStateIdle();
      pad.collabClient.setIsPendingRevision(true);
    }
    // Don't throw an exception. Error events do not indicate problems that are not already
    // addressed by reconnection logic, so throwing an exception each time there's a socket.io error
    // just annoys users and fills logs.
  });

  socket.on('message', (obj) => {
    // the access was not granted, give the user a message
    if (obj.accessStatus) {
      if (obj.accessStatus === 'deny') {
        $('#loading').hide();
        $('#permissionDenied').show();

        if (receivedClientVars) {
          // got kicked
          $('#editorcontainer').hide();
          $('#editorloadingbox').show();
        }
      }
    } else if (!receivedClientVars && obj.type === 'CLIENT_VARS') {
      receivedClientVars = true;
      window.clientVars = obj.data;
      if (window.clientVars.sessionRefreshInterval) {
        const ping =
            () => $.ajax('../_extendExpressSessionLifetime', {method: 'PUT'}).catch(() => {});
        setInterval(ping, window.clientVars.sessionRefreshInterval);
      }
      if(window.clientVars.mode === "development") {
        console.warn('Enabling development mode with live update')
        socket.on('liveupdate', ()=>{

          console.log('Live reload update received')
          location.reload()
        })
      }

    } else if (obj.disconnect) {
      padconnectionstatus.disconnected(obj.disconnect);
      socket.disconnect();

      // block user from making any change to the pad
      padeditor.disable();
      padeditbar.disable();
      padimpexp.disable();

      return;
    } else {
      pad._messageQ.enqueue(obj);
    }
  });

  await Promise.all([
    new Promise((resolve) => {
      const h = (obj) => {
        if (obj.accessStatus || obj.type !== 'CLIENT_VARS') return;
        socket.off('message', h);
        resolve();
      };
      socket.on('message', h);
    }),
    // This hook is only intended to be used by test code. If a plugin would like to use this hook,
    // the hook must first be promoted to officially supported by deleting the leading underscore
    // from the name, adding documentation to `doc/api/hooks_client-side.md`, and deleting this
    // comment.
    hooks.aCallAll('_socketCreated', {socket}),
  ]);
};

/** Defers message handling until setCollabClient() is called with a non-null value. */
class MessageQueue {
  constructor() {
    this._q = [];
    this._cc = null;
  }

  setCollabClient(cc) {
    this._cc = cc;
    this.enqueue(); // Flush.
  }

  enqueue(...msgs) {
    if (this._cc == null) {
      this._q.push(...msgs);
    } else {
      while (this._q.length > 0) this._cc.handleMessageFromServer(this._q.shift());
      for (const msg of msgs) this._cc.handleMessageFromServer(msg);
    }
  }
}

const pad = {
  // don't access these directly from outside this file, except
  // for debugging
  collabClient: null,
  myUserInfo: null,
  diagnosticInfo: {},
  initTime: 0,
  clientTimeOffset: null,
  padOptions: {},
  _messageQ: new MessageQueue(),

  // these don't require init; clientVars should all go through here
  getPadId: () => clientVars.padId,
  getClientIp: () => clientVars.clientIp,
  getColorPalette: () => clientVars.colorPalette,
  getPrivilege: (name) => clientVars.accountPrivs[name],
  getUserId: () => pad.myUserInfo.userId,
  getUserName: () => pad.myUserInfo.name,
  userList: () => paduserlist.users(),
  sendClientMessage: (msg) => {
    pad.collabClient.sendClientMessage(msg);
  },

  init() {
    padutils.setupGlobalExceptionHandler();

    // $(handler), $().ready(handler), $.wait($.ready).then(handler), etc. don't work if handler is
    // an async function for some bizarre reason, so the async function is wrapped in a non-async
    // function.
    $(() => (async () => {
      if (window.customStart != null) window.customStart();
      $('#colorpicker').farbtastic({callback: '#mycolorpickerpreview', width: 220});
      $('#readonlyinput').on('click', () => { padeditbar.setEmbedLinks(); });
      padcookie.init();
      await handshake();
      this._afterHandshake();
    })());
  },
  _afterHandshake() {
    pad.clientTimeOffset = Date.now() - clientVars.serverTimestamp;
    // initialize the chat
    chat.init(this);
    getParams();

    padcookie.init(); // initialize the cookies
    pad.initTime = +(new Date());
    pad.padOptions = clientVars.initialOptions;

    pad.myUserInfo = {
      userId: clientVars.userId,
      name: clientVars.userName,
      ip: pad.getClientIp(),
      colorId: clientVars.userColor,
    };

    const postAceInit = () => {
      padeditbar.init();
      setTimeout(() => {
        padeditor.ace.focus();
      }, 0);
      const optionsStickyChat = $('#options-stickychat');
      optionsStickyChat.on('click', () => { chat.stickToScreen(); });
      // if we have a cookie for always showing chat then show it
      if (padcookie.getPref('chatAlwaysVisible')) {
        chat.stickToScreen(true); // stick it to the screen
        optionsStickyChat.prop('checked', true); // set the checkbox to on
      }
      // if we have a cookie for always showing chat then show it
      if (padcookie.getPref('chatAndUsers')) {
        chat.chatAndUsers(true); // stick it to the screen
        $('#options-chatandusers').prop('checked', true); // set the checkbox to on
      }
      if (padcookie.getPref('showAuthorshipColors') === false) {
        pad.changeViewOption('showAuthorColors', false);
      }
      if (padcookie.getPref('showLineNumbers') === false) {
        pad.changeViewOption('showLineNumbers', false);
      }
      if (padcookie.getPref('rtlIsTrue') === true) {
        pad.changeViewOption('rtlIsTrue', true);
      }
      pad.changeViewOption('padFontFamily', padcookie.getPref('padFontFamily'));
      $('#viewfontmenu').val(padcookie.getPref('padFontFamily')).niceSelect('update');

      // Prevent sticky chat or chat and users to be checked for mobiles
      const checkChatAndUsersVisibility = (x) => {
        if (x.matches) { // If media query matches
          $('#options-chatandusers:checked').trigger('click');
          $('#options-stickychat:checked').trigger('click');
        }
      };
      const mobileMatch = window.matchMedia('(max-width: 800px)');
      mobileMatch.addListener(checkChatAndUsersVisibility); // check if window resized
      setTimeout(() => { checkChatAndUsersVisibility(mobileMatch); }, 0); // check now after load

      $('#editorcontainer').addClass('initialized');

      if (window.clientVars.enableDarkMode) {
        $('#theme-switcher').attr('style', 'display: flex;');
      }

      if (window.location.hash.toLowerCase() !== '#skinvariantsbuilder' && window.clientVars.enableDarkMode && (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) && !skinVariants.isWhiteModeEnabledInLocalStorage()) {
        skinVariants.updateSkinVariantsClasses(['super-dark-editor', 'dark-background', 'super-dark-toolbar']);
      }

      hooks.aCallAll('postAceInit', {ace: padeditor.ace, clientVars, pad});
    };

    // order of inits is important here:
    padimpexp.init(this);
    padsavedrevs.init(this);
    padeditor.init(pad.padOptions.view || {}, this).then(postAceInit);
    paduserlist.init(pad.myUserInfo, this);
    padconnectionstatus.init();
    padmodals.init(this);

    pad.collabClient = getCollabClient(
        padeditor.ace, clientVars.collab_client_vars, pad.myUserInfo,
        {colorPalette: pad.getColorPalette()}, pad);
    this._messageQ.setCollabClient(this.collabClient);
    pad.collabClient.setOnUserJoin(pad.handleUserJoin);
    pad.collabClient.setOnUpdateUserInfo(pad.handleUserUpdate);
    pad.collabClient.setOnUserLeave(pad.handleUserLeave);
    pad.collabClient.setOnClientMessage(pad.handleClientMessage);
    pad.collabClient.setOnChannelStateChange(pad.handleChannelStateChange);
    pad.collabClient.setOnInternalAction(pad.handleCollabAction);

    // load initial chat-messages
    if (clientVars.chatHead !== -1) {
      const chatHead = clientVars.chatHead;
      const start = Math.max(chatHead - 100, 0);
      pad.collabClient.sendMessage({type: 'GET_CHAT_MESSAGES', start, end: chatHead});
    } else {
      // there are no messages
      $('#chatloadmessagesbutton').css('display', 'none');
    }

    if (window.clientVars.readonly) {
      chat.hide();
      $('#myusernameedit').attr('disabled', true);
      $('#chatinput').attr('disabled', true);
      $('#chaticon').hide();
      $('#options-chatandusers').parent().hide();
      $('#options-stickychat').parent().hide();
    } else if (!settings.hideChat) { $('#chaticon').show(); }

    $('body').addClass(window.clientVars.readonly ? 'readonly' : 'readwrite');

    padeditor.ace.callWithAce((ace) => {
      ace.ace_setEditable(!window.clientVars.readonly);
    });

    // If the LineNumbersDisabled value is set to true then we need to hide the Line Numbers
    if (settings.LineNumbersDisabled === true) {
      this.changeViewOption('showLineNumbers', false);
    }

    // If the noColors value is set to true then we need to
    // hide the background colors on the ace spans
    if (settings.noColors === true) {
      this.changeViewOption('noColors', true);
    }

    if (settings.rtlIsTrue === true) {
      this.changeViewOption('rtlIsTrue', true);
    }

    // If the Monospacefont value is set to true then change it to monospace.
    if (settings.useMonospaceFontGlobal === true) {
      this.changeViewOption('padFontFamily', 'RobotoMono');
    }
    // if the globalUserName value is set we need to tell the server and
    // the client about the new authorname
    if (settings.globalUserName !== false) {
      this.notifyChangeName(settings.globalUserName); // Notifies the server
      this.myUserInfo.name = settings.globalUserName;
      $('#myusernameedit').val(settings.globalUserName); // Updates the current users UI
    }
    if (settings.globalUserColor !== false && colorutils.isCssHex(settings.globalUserColor)) {
      // Add a 'globalUserColor' property to myUserInfo,
      // so collabClient knows we have a query parameter.
      this.myUserInfo.globalUserColor = settings.globalUserColor;
      this.notifyChangeColor(settings.globalUserColor); // Updates this.myUserInfo.colorId
      paduserlist.setMyUserInfo(this.myUserInfo);
    }
  },

  dispose: () => {
    padeditor.dispose();
  },
  notifyChangeName: (newName) => {
    pad.myUserInfo.name = newName;
    pad.collabClient.updateUserInfo(pad.myUserInfo);
  },
  notifyChangeColor: (newColorId) => {
    pad.myUserInfo.colorId = newColorId;
    pad.collabClient.updateUserInfo(pad.myUserInfo);
  },
  changePadOption: (key, value) => {
    const options = {};
    options[key] = value;
    pad.handleOptionsChange(options);
    pad.collabClient.sendClientMessage(
        {
          type: 'padoptions',
          options,
          changedBy: pad.myUserInfo.name || 'unnamed',
        });
  },
  changeViewOption: (key, value) => {
    const options = {
      view: {},
    };
    options.view[key] = value;
    pad.handleOptionsChange(options);
  },
  handleOptionsChange: (opts) => {
    // opts object is a full set of options or just
    // some options to change
    if (opts.view) {
      if (!pad.padOptions.view) {
        pad.padOptions.view = {};
      }
      for (const [k, v] of Object.entries(opts.view)) {
        pad.padOptions.view[k] = v;
        padcookie.setPref(k, v);
      }
      padeditor.setViewOptions(pad.padOptions.view);
    }
  },
  // caller shouldn't mutate the object
  getPadOptions: () => pad.padOptions,
  suggestUserName: (userId, name) => {
    pad.collabClient.sendClientMessage(
        {
          type: 'suggestUserName',
          unnamedId: userId,
          newName: name,
        });
  },
  handleUserJoin: (userInfo) => {
    paduserlist.userJoinOrUpdate(userInfo);
  },
  handleUserUpdate: (userInfo) => {
    paduserlist.userJoinOrUpdate(userInfo);
  },
  handleUserLeave: (userInfo) => {
    paduserlist.userLeave(userInfo);
  },
  handleClientMessage: (msg) => {
    if (msg.type === 'suggestUserName') {
      if (msg.unnamedId === pad.myUserInfo.userId && msg.newName && !pad.myUserInfo.name) {
        pad.notifyChangeName(msg.newName);
        paduserlist.setMyUserInfo(pad.myUserInfo);
      }
    } else if (msg.type === 'newRevisionList') {
      padsavedrevs.newRevisionList(msg.revisionList);
    } else if (msg.type === 'revisionLabel') {
      padsavedrevs.newRevisionList(msg.revisionList);
    } else if (msg.type === 'padoptions') {
      const opts = msg.options;
      pad.handleOptionsChange(opts);
    }
  },
  handleChannelStateChange: (newState, message) => {
    const oldFullyConnected = !!padconnectionstatus.isFullyConnected();
    const wasConnecting = (padconnectionstatus.getStatus().what === 'connecting');
    if (newState === 'CONNECTED') {
      padeditor.enable();
      padeditbar.enable();
      padimpexp.enable();
      padconnectionstatus.connected();
    } else if (newState === 'RECONNECTING') {
      padeditor.disable();
      padeditbar.disable();
      padimpexp.disable();
      padconnectionstatus.reconnecting();
    } else if (newState === 'DISCONNECTED') {
      pad.diagnosticInfo.disconnectedMessage = message;
      pad.diagnosticInfo.padId = pad.getPadId();
      pad.diagnosticInfo.socket = {};

      // we filter non objects from the socket object and put them in the diagnosticInfo
      // this ensures we have no cyclic data - this allows us to stringify the data
      for (const [i, value] of Object.entries(socket.socket || {})) {
        const type = typeof value;

        if (type === 'string' || type === 'number') {
          pad.diagnosticInfo.socket[i] = value;
        }
      }

      pad.asyncSendDiagnosticInfo();
      if (typeof window.ajlog === 'string') {
        window.ajlog += (`Disconnected: ${message}\n`);
      }
      padeditor.disable();
      padeditbar.disable();
      padimpexp.disable();

      padconnectionstatus.disconnected(message);
    }
    const newFullyConnected = !!padconnectionstatus.isFullyConnected();
    if (newFullyConnected !== oldFullyConnected) {
      pad.handleIsFullyConnected(newFullyConnected, wasConnecting);
    }
  },
  handleIsFullyConnected: (isConnected, isInitialConnect) => {
    pad.determineChatVisibility(isConnected && !isInitialConnect);
    pad.determineChatAndUsersVisibility(isConnected && !isInitialConnect);
    pad.determineAuthorshipColorsVisibility();
    setTimeout(() => {
      padeditbar.toggleDropDown('none');
    }, 1000);
  },
  determineChatVisibility: (asNowConnectedFeedback) => {
    const chatVisCookie = padcookie.getPref('chatAlwaysVisible');
    if (chatVisCookie) { // if the cookie is set for chat always visible
      chat.stickToScreen(true); // stick it to the screen
      $('#options-stickychat').prop('checked', true); // set the checkbox to on
    } else {
      $('#options-stickychat').prop('checked', false); // set the checkbox for off
    }
  },
  determineChatAndUsersVisibility: (asNowConnectedFeedback) => {
    const chatAUVisCookie = padcookie.getPref('chatAndUsersVisible');
    if (chatAUVisCookie) { // if the cookie is set for chat always visible
      chat.chatAndUsers(true); // stick it to the screen
      $('#options-chatandusers').prop('checked', true); // set the checkbox to on
    } else {
      $('#options-chatandusers').prop('checked', false); // set the checkbox for off
    }
  },
  determineAuthorshipColorsVisibility: () => {
    const authColCookie = padcookie.getPref('showAuthorshipColors');
    if (authColCookie) {
      pad.changeViewOption('showAuthorColors', true);
      $('#options-colorscheck').prop('checked', true);
    } else {
      $('#options-colorscheck').prop('checked', false);
    }
  },
  handleCollabAction: (action) => {
    if (action === 'commitPerformed') {
      padeditbar.setSyncStatus('syncing');
    } else if (action === 'newlyIdle') {
      padeditbar.setSyncStatus('done');
    }
  },
  asyncSendDiagnosticInfo: () => {
    const currentUrl = window.location.href;
    fetch('../ep/pad/connection-diagnostic-info', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        diagnosticInfo: pad.diagnosticInfo,
      }),
    }).catch((error) => {
      console.error('Error sending diagnostic info:', error);
    })
  },
  forceReconnect: () => {
    $('form#reconnectform input.padId').val(pad.getPadId());
    pad.diagnosticInfo.collabDiagnosticInfo = pad.collabClient.getDiagnosticInfo();
    $('form#reconnectform input.diagnosticInfo').val(JSON.stringify(pad.diagnosticInfo));
    $('form#reconnectform input.missedChanges')
        .val(JSON.stringify(pad.collabClient.getMissedChanges()));
    $('form#reconnectform').trigger('submit');
  },
  callWhenNotCommitting: (f) => {
    pad.collabClient.callWhenNotCommitting(f);
  },
  getCollabRevisionNumber: () => pad.collabClient.getCurrentRevisionNumber(),
  isFullyConnected: () => padconnectionstatus.isFullyConnected(),
  addHistoricalAuthors: (data) => {
    if (!pad.collabClient) {
      window.setTimeout(() => {
        pad.addHistoricalAuthors(data);
      }, 1000);
    } else {
      pad.collabClient.addHistoricalAuthors(data);
    }
  },
};

const init = () => pad.init();

const settings = {
  LineNumbersDisabled: false,
  noColors: false,
  useMonospaceFontGlobal: false,
  globalUserName: false,
  globalUserColor: false,
  rtlIsTrue: false,
};

pad.settings = settings;

exports.baseURL = '';
exports.settings = settings;
exports.randomString = randomString;
exports.getParams = getParams;
exports.pad = pad;
exports.init = init;
