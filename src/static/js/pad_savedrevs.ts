// @ts-nocheck
'use strict';

/**
 * Copyright 2012 Peter 'Pita' Martischka
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

let pad;

exports.saveNow = () => {
  pad.collabClient.sendMessage({type: 'SAVE_REVISION'});
  window.$.gritter.add({
    // (string | mandatory) the heading of the notification
    title: html10n.get('pad.savedrevs.marked'),
    // (string | mandatory) the text inside the notification
    text: html10n.get('pad.savedrevs.timeslider') ||
        'You can view saved revisions in the timeslider',
    // (bool | optional) if you want it to fade out on its own or just sit there
    sticky: false,
    time: 3000,
    class_name: 'saved-revision',
  });
};

exports.init = (_pad) => {
  pad = _pad;
};
