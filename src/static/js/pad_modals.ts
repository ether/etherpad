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

const padeditbar = require('./pad_editbar').padeditbar;
const automaticReconnect = require('./pad_automatic_reconnect');

const padmodals = (() => {
  let pad = undefined;
  const self = {
    init: (_pad) => {
      pad = _pad;
    },
    showModal: (messageId) => {
      padeditbar.toggleDropDown('none');
      $('#connectivity .visible').removeClass('visible');
      $(`#connectivity .${messageId}`).addClass('visible');

      const $modal = $(`#connectivity .${messageId}`);
      automaticReconnect.showCountDownTimerToReconnectOnModal($modal, pad);

      padeditbar.toggleDropDown('connectivity');
    },
    showOverlay: () => {
      // Prevent the user to interact with the toolbar. Useful when user is disconnected for example
      $('#toolbar-overlay').show();
    },
    hideOverlay: () => {
      $('#toolbar-overlay').hide();
    },
  };
  return self;
})();

exports.padmodals = padmodals;
