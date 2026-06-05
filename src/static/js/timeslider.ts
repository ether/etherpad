// @ts-nocheck
'use strict';

/**
 * This code is mostly from the old Etherpad. Please help us to comment this code.
 * This helps other people to understand this code better and helps them to improve it.
 * TL;DR COMMENTS ON THIS FILE ARE HIGHLY APPRECIATED
 */

/**
 * Copyright 2009 Google Inc.
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

// These jQuery things should create local references, but for now `require()`
// assigns to the global `$` and augments it with plugins.
require('./vendors/jquery');

import {Cookies} from "./pad_utils";
const hooks = require('./pluginfw/hooks');
import padutils from './pad_utils'
const socketio = require('./socketio');
import html10n from '../js/vendors/html10n'
let padId, exportLinks, socket, changesetLoader, BroadcastSlider;
let cp = '';
const playbackSpeedCookie = 'timesliderPlaybackSpeed';

const getPrefsCookieName = () => `${cp}${window.location.protocol === 'https:' ? 'prefs' : 'prefsHttp'}`;

const readPadPrefs = () => {
  try {
    let json = Cookies.get(getPrefsCookieName());
    if (json == null) {
      const unprefixed = window.location.protocol === 'https:' ? 'prefs' : 'prefsHttp';
      if (unprefixed !== getPrefsCookieName()) json = Cookies.get(unprefixed);
    }
    return json == null ? {} : JSON.parse(json);
  } catch (err) {
    return {};
  }
};

const writePadPrefs = (prefs) => {
  Cookies.set(getPrefsCookieName(), JSON.stringify(prefs), {expires: 365 * 100});
};

const setPadPref = (prefName, value) => {
  const prefs = readPadPrefs();
  prefs[prefName] = value;
  writePadPrefs(prefs);
};

const applyShowLineNumbers = (showLineNumbers) => {
  padutils.setCheckbox($('#options-linenoscheck'), showLineNumbers);
  $('body').toggleClass('line-numbers-hidden', !showLineNumbers);
  window.requestAnimationFrame(() => $(window).trigger('resize'));
};

const applyShowAuthorColors = (showAuthorColors) => {
  $('#innerdocbody').toggleClass('authorColors', showAuthorColors);
  $('#sidedivinner').toggleClass('authorColors', showAuthorColors);
};

const init = () => {
  padutils.setupGlobalExceptionHandler();
  $(document).ready(() => {
    // start the custom js
    if (typeof customStart === 'function') customStart(); // eslint-disable-line no-undef

    // Issue #7659: when this timeslider is mounted as the in-place history
    // iframe inside a pad page, mark the body so CSS can hide the inner
    // editbar (the outer pad's toolbar owns the slider) and inherit the
    // parent's skin tokens so dark mode (and any other skinVariants the
    // user toggled at runtime) is applied immediately on first paint.
    // Direct visits to /p/:pad/timeslider?embed=1 (existing test/legacy
    // entry points) keep their full chrome because parent === window.
    try {
      if (window.parent !== window) {
        document.body.classList.add('iframe-mode');
        const parentClasses = window.parent.document.documentElement.className || '';
        const tokens = parentClasses.split(/\s+/).filter((c) =>
            /^(super-light|light|dark|super-dark)-(toolbar|editor|background)$/.test(c) ||
            c === 'full-width-editor');
        if (tokens.length) {
          document.documentElement.classList.add(...tokens);
        }
      }
    } catch (_e) { /* cross-origin parent — leave defaults */ }

    // get the padId out of the url
    const urlParts = document.location.pathname.split('/');
    padId = decodeURIComponent(urlParts[urlParts.length - 2]);

    // set the title
    document.title = `${padId.replace(/_+/g, ' ')} | ${document.title}`;

    // The author token is an HttpOnly cookie set by the server on
    // /p/:pad/timeslider (ether/etherpad#6701 PR3). The browser never reads
    // or writes it; the server picks it up from the socket.io handshake.
    cp = (window as any).clientVars?.cookiePrefix || '';

    // Pass `embed` to the server when this timeslider is the in-place
    // history iframe inside a pad page (issue #7659). Without this the
    // server's duplicate-author kick treats the iframe's connection as a
    // stale tab and disconnects the parent pad's live socket.
    const embed = (() => {
      try {
        if (window.parent === window) return false;
        const params = new URLSearchParams(window.location.search);
        return params.get('embed') === '1';
      } catch (_e) { return false; }
    })();
    socket = socketio.connect(
        exports.baseURL, '/', {query: embed ? {padId, embed: '1'} : {padId}});

    // send the ready message once we're connected
    socket.on('connect', () => {
      sendSocketMsg('CLIENT_READY', {});
    });

    socket.on('disconnect', (reason) => {
      BroadcastSlider.showReconnectUI();
      // The socket.io client will automatically try to reconnect for all reasons other than "io
      // server disconnect".
      if (reason === 'io server disconnect') socket.connect();
    });

    // route the incoming messages
    socket.on('message', (message) => {
      if (message.type === 'CLIENT_VARS') {
        handleClientVars(message);
      } else if (message.accessStatus) {
        $('body').html('<h2>You have no permission to access this pad</h2>');
      } else if (message.type === 'CHANGESET_REQ' || message.type === 'COLLABROOM') {
        changesetLoader.handleMessageFromServer(message);
      }
    });

    // get all the export links
    exportLinks = $('#export > .exportlink');

    $('button#forcereconnect').on('click', () => {
      window.location.reload();
    });

    exports.socket = socket; // make the socket available
    exports.BroadcastSlider = BroadcastSlider; // Make the slider available

    hooks.aCallAll('postTimesliderInit');
  });
};

// sends a message over the socket
// The integrator-set `sessionID` cookie is consumed server-side from the
// socket.io handshake (issue #7045). It does not need to ride on every
// message; the server only reads it during CLIENT_READY.
const sendSocketMsg = (type, data) => {
  socket.emit("message", {
    component: 'pad', // FIXME: Remove this stupidity!
    type,
    data,
    padId,
  });
};

const fireWhenAllScriptsAreLoaded = [];

const handleClientVars = (message) => {
  // save the client Vars
  window.clientVars = message.data;
  cp = (window as any).clientVars?.cookiePrefix || '';

  if (window.clientVars.sessionRefreshInterval) {
    const ping =
        () => $.ajax('../../_extendExpressSessionLifetime', {method: 'PUT'}).catch(() => {});
    setInterval(ping, window.clientVars.sessionRefreshInterval);
  }

  if(window.clientVars.mode === "development") {
    console.warn('Enabling development mode with live update')
    socket.on('liveupdate', ()=>{
      console.log('Doing live reload')
      location.reload()
    })
  }

  // load all script that doesn't work without the clientVars
  BroadcastSlider = require('./broadcast_slider')
      .loadBroadcastSliderJS(fireWhenAllScriptsAreLoaded);
  BroadcastSlider.setShowAuthorColors = (showAuthorColors) => {
    applyShowAuthorColors(showAuthorColors);
    setPadPref('showAuthorshipColors', showAuthorColors);
  };
  BroadcastSlider.setShowLineNumbers = (showLineNumbers) => {
    applyShowLineNumbers(showLineNumbers);
    setPadPref('showLineNumbers', showLineNumbers);
  };
  // Exposed on window so the outer pad shell (issue #7659 in-place history
  // mode) can subscribe to slider movement without postMessage round-trips.
  (window as any).BroadcastSlider = BroadcastSlider;

  require('./broadcast_revisions').loadBroadcastRevisionsJS();
  changesetLoader = require('./broadcast')
      .loadBroadcastJS(socket, sendSocketMsg, fireWhenAllScriptsAreLoaded, BroadcastSlider);

  // initialize export ui
  require('./pad_impexp').padimpexp.init();

  // Create a base URI used for timeslider exports
  const baseURI = document.location.pathname;

  // change export urls when the slider moves
  BroadcastSlider.onSlider((revno) => {
    // exportLinks is a jQuery Array, so .each is allowed.
    exportLinks.each(function () {
      // Modified from regular expression to fix:
      // https://github.com/ether/etherpad-lite/issues/4071
      // Where a padId that was numeric would create the wrong export link
      if (this.href) {
        const type = this.href.split('export/')[1];
        let href = baseURI.split('timeslider')[0];
        href += `${revno}/export/${type}`;
        this.setAttribute('href', href);
      }
    });
  });

  // fire all start functions of these scripts, formerly fired with window.load
  for (let i = 0; i < fireWhenAllScriptsAreLoaded.length; i++) {
    fireWhenAllScriptsAreLoaded[i]();
  }
  $('#ui-slider-handle').css('left', $('#ui-slider-bar').width() - 2);

  // Translate some strings where we only want to set the title not the actual values
  $('#playpause_button_icon').attr('title', html10n.get('timeslider.playPause'));
  $('#leftstep').attr('title', html10n.get('timeslider.backRevision'));
  $('#rightstep').attr('title', html10n.get('timeslider.forwardRevision'));
  padutils.bindCheckboxChange($('#options-linenoscheck'), () => {
    const showLineNumbers = padutils.getCheckbox('#options-linenoscheck');
    setPadPref('showLineNumbers', showLineNumbers);
    applyShowLineNumbers(showLineNumbers);
  });
  applyShowLineNumbers(readPadPrefs().showLineNumbers !== false);

  // Read authorship colors preference from cookie (set by pad editor)
  applyShowAuthorColors(readPadPrefs().showAuthorshipColors !== false);

  // font family
  const applyPadFontFamily = (fontFamily) => {
    if (fontFamily) {
      $('#innerdocbody').css('font-family', fontFamily);
    } else {
      $('#innerdocbody').css('font-family', '');
    }
  };
  const padFontFamily = readPadPrefs().padFontFamily;
  if (padFontFamily) $('#viewfontmenu').val(padFontFamily);
  applyPadFontFamily(padFontFamily);
  $('#viewfontmenu').on('change', function () {
    const fontFamily = $(this).val() || '';
    setPadPref('padFontFamily', fontFamily);
    applyPadFontFamily(fontFamily);
  });

  BroadcastSlider.setPadFontFamily = (fontFamily) => {
    applyPadFontFamily(fontFamily);
    setPadPref('padFontFamily', fontFamily);
  };

  const savedPlaybackSpeed = Cookies.get(`${cp}${playbackSpeedCookie}`) || '100';
  $('#playbackspeed').val(savedPlaybackSpeed);
  BroadcastSlider.setPlaybackSpeed(savedPlaybackSpeed);
  $('#playbackspeed').on('change', function () {
    const speed = String($(this).val() || '100');
    Cookies.set(`${cp}${playbackSpeedCookie}`, speed);
    BroadcastSlider.setPlaybackSpeed(speed);
  });
};

exports.baseURL = '';
exports.init = init;
