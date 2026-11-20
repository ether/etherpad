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
    const prefix = (window as any).clientVars?.cookiePrefix || '';
    this.cookieName_ = prefix + (window.location.protocol === 'https:' ? 'prefs' : 'prefsHttp');
    // In-memory copy of the prefs, used when the cookie can't be read or written (e.g. a
    // cross-site iframe over http, where the browser rejects the cookie).
    this.prefs_ = {};
    // Set once a cookie write doesn't stick, so a stale cookie can't mask newer in-memory prefs.
    this.memoryOnly_ = false;
  }

  init() {
    const prefs = this.getPrefs_();
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
      let json = Cookies.get(this.cookieName_);
      // Fall back to unprefixed cookie for migration
      if (json == null) {
        const unprefixed = window.location.protocol === 'https:' ? 'prefs' : 'prefsHttp';
        if (unprefixed !== this.cookieName_) json = Cookies.get(unprefixed);
      }
      if (json == null) return null;
      return JSON.parse(json);
    } catch (e) {
      return null;
    }
  }

  writePrefs_(prefs) {
    this.prefs_ = {...prefs};
    const json = JSON.stringify(prefs);
    try {
      Cookies.set(this.cookieName_, json, {expires: 365 * 100});
      if (Cookies.get(this.cookieName_) !== json) this.memoryOnly_ = true;
    } catch (e) {
      this.memoryOnly_ = true;
    }
  }

  getPrefs_() {
    if (this.memoryOnly_) return {...this.prefs_};
    return this.readPrefs_() || {...this.prefs_};
  }

  getPref(prefName) {
    return this.getPrefs_()[prefName];
  }

  setPref(prefName, value) {
    const prefs = this.getPrefs_();
    prefs[prefName] = value;
    this.writePrefs_(prefs);
  }

  clear() {
    this.writePrefs_({});
  }
}();
