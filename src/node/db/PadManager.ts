'use strict';
/**
 * The Pad Manager is a Factory for pad Objects
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

import {MapArrayType} from "../types/MapType";
import {PadType} from "../types/PadType";

const CustomError = require('../utils/customError');
const Pad = require('../db/Pad');
const db = require('./DB');
import settings from '../utils/Settings';

/**
 * A cache of all loaded Pads.
 *
 * Provides "get" and "set" functions,
 * which should be used instead of indexing with brackets. These prepend a
 * colon to the key, to avoid conflicting with built-in Object methods or with
 * these functions themselves.
 *
 * If this is needed in other places, it would be wise to make this a prototype
 * that's defined somewhere more sensible.
 */
const globalPads:MapArrayType<any> = {
  get(name: string)
  {
    return this[`:${name}`];
    },
  set(name: string, value: any)
  {
    this[`:${name}`] = value;
  },
  remove(name: string) {
    delete this[`:${name}`];
  },
};

/**
 * A cache of the list of all pads.
 *
 * Updated without db access as new pads are created/old ones removed.
 */
const padList = new class {
  private _cachedList: string[] | null;
    private _list: Set<string>;
    private _loaded: Promise<void> | null;
  constructor() {
    this._cachedList = null;
    this._list = new Set();
    this._loaded = null;
  }

  /**
   * Returns all pads in alphabetical order as array.
   * @returns {Promise<string[]>} A promise that resolves to an array of pad IDs.
   */
  async getPads() {
    if (!this._loaded) {
      this._loaded = (async () => {
        const dbData = await db.findKeys('pad:*', '*:*:*');
        if (dbData == null) return;
        for (const val of dbData) this.addPad(val.replace(/^pad:/, ''));
      })();
    }
    await this._loaded;
    if (!this._cachedList) this._cachedList = [...this._list].sort();
    return this._cachedList;
  }

  addPad(name: string) {
    if (this._list.has(name)) return;
    this._list.add(name);
    this._cachedList = null;
  }

  removePad(name: string) {
    if (!this._list.has(name)) return;
    this._list.delete(name);
    this._cachedList = null;
  }
}();

// initialises the all-knowing data structure

/**
 * Returns a Pad Object with the callback
 * @param id A String with the id of the pad
 * @param {string} [text] - Optional initial pad text if creating a new pad.
 * @param {string} [authorId] - Optional author ID of the user that initiated the pad creation (if
 *     applicable).
 */
exports.getPad = async (id: string, text?: string|null, authorId:string|null = ''):Promise<PadType> => {
  // check if this is a valid padId
  if (!exports.isValidPadId(id)) {
    throw new CustomError(`${id} is not a valid padId`, 'apierror');
  }

  // check if this is a valid text
  if (text != null) {
    // check if text is a string
    if (typeof text !== 'string') {
      throw new CustomError('text is not a string', 'apierror');
    }

    // check if text is less than 100k chars
    if (text.length > 100000) {
      throw new CustomError('text must be less than 100k chars', 'apierror');
    }
  }

  let pad = globalPads.get(id);

  // return pad if it's already loaded
  if (pad != null) {
    return pad;
  }

  // try to load pad
  pad = new Pad.Pad(id);

  // initialize the pad
  await pad.init(text, authorId);
  globalPads.set(id, pad);
  padList.addPad(id);

  return pad;
};

exports.listAllPads = async () => {
  const padIDs = await padList.getPads();

  return {padIDs};
};




// checks if a pad exists
exports.doesPadExist = async (padId: string) => {
  const value = await db.get(`pad:${padId}`);

  return (value != null && value.atext);
};

// alias for backwards compatibility
exports.doesPadExists = exports.doesPadExist;

/**
 * An array of padId transformations. These represent changes in pad name policy over
 * time, and allow us to "play back" these changes so legacy padIds can be found.
 */
const padIdTransforms = [
  [/\s+/g, '_'],
  [/:+/g, '_'],
];

// returns a sanitized padId, respecting legacy pad id formats
exports.sanitizePadId = async (padId: string) => {
  for (let i = 0, n = padIdTransforms.length; i < n; ++i) {
    const exists = await exports.doesPadExist(padId);

    if (exists) {
      return padId;
    }

    const [from, to] = padIdTransforms[i];

    // @ts-ignore
    padId = padId.replace(from, to);
  }

  if (settings.lowerCasePadIds) padId = padId.toLowerCase();

  // we're out of possible transformations, so just return it
  return padId;
};

exports.isValidPadId = (padId: string) => /^(g.[a-zA-Z0-9]{16}\$)?[^$]{1,50}$/.test(padId);

/**
 * Removes the pad from database and unloads it.
 */
exports.removePad = async (padId: string) => {
  const p = db.remove(`pad:${padId}`);
  exports.unloadPad(padId);
  padList.removePad(padId);
  await p;
};

// removes a pad from the cache
exports.unloadPad = (padId: string) => {
  globalPads.remove(padId);
};
