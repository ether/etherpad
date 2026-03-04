// @ts-nocheck
'use strict';

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

import {Cookies} from "./pad_utils";

exports.padcookie = new class {
  constructor() {
    this.cookieName_ = window.location.protocol === 'https:' ? 'prefs' : 'prefsHttp';
  }

  init() {
    const prefs = this.readPrefs_() || {};
    delete prefs.userId;
    delete prefs.name;
    delete prefs.colorId;
    this.writePrefs_(prefs);
    // Re-read the saved cookie to test if cookies are enabled.
    if (this.readPrefs_() == null) {
      $.gritter.add({
        title: 'Error',
        text: html10n.get('pad.noCookie'),
        sticky: true,
        class_name: 'error',
      });
    }
  }

  readPrefs_() {
    try {
      const json = Cookies.get(this.cookieName_);
      if (json == null) return null;
      return JSON.parse(json);
    } catch (e) {
      return null;
    }
  }

  writePrefs_(prefs) {
    Cookies.set(this.cookieName_, JSON.stringify(prefs), {expires: 365 * 100});
  }

  getPref(prefName) {
    return this.readPrefs_()[prefName];
  }

  setPref(prefName, value) {
    const prefs = this.readPrefs_();
    prefs[prefName] = value;
    this.writePrefs_(prefs);
  }

  clear() {
    this.writePrefs_({});
  }
}();
