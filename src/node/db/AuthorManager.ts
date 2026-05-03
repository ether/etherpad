'use strict';
/**
 * The AuthorManager controlls all information about the Pad authors
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

const db = require('./DB');
const CustomError = require('../utils/customError');
const hooks = require('../../static/js/pluginfw/hooks');
import padutils, {randomString} from "../../static/js/pad_utils";

exports.getColorPalette = () => [
  '#ffc7c7',
  '#fff1c7',
  '#e3ffc7',
  '#c7ffd5',
  '#c7ffff',
  '#c7d5ff',
  '#e3c7ff',
  '#ffc7f1',
  '#ffa8a8',
  '#ffe699',
  '#cfff9e',
  '#99ffb3',
  '#a3ffff',
  '#99b3ff',
  '#cc99ff',
  '#ff99e5',
  '#e7b1b1',
  '#e9dcAf',
  '#cde9af',
  '#bfedcc',
  '#b1e7e7',
  '#c3cdee',
  '#d2b8ea',
  '#eec3e6',
  '#e9cece',
  '#e7e0ca',
  '#d3e5c7',
  '#bce1c5',
  '#c1e2e2',
  '#c1c9e2',
  '#cfc1e2',
  '#e0bdd9',
  '#baded3',
  '#a0f8eb',
  '#b1e7e0',
  '#c3c8e4',
  '#cec5e2',
  '#b1d5e7',
  '#cda8f0',
  '#f0f0a8',
  '#f2f2a6',
  '#f5a8eb',
  '#c5f9a9',
  '#ececbb',
  '#e7c4bc',
  '#daf0b2',
  '#b0a0fd',
  '#bce2e7',
  '#cce2bb',
  '#ec9afe',
  '#edabbd',
  '#aeaeea',
  '#c4e7b1',
  '#d722bb',
  '#f3a5e7',
  '#ffa8a8',
  '#d8c0c5',
  '#eaaedd',
  '#adc6eb',
  '#bedad1',
  '#dee9af',
  '#e9afc2',
  '#f8d2a0',
  '#b3b3e6',
];

/**
 * Checks if the author exists
 * @param {String} authorID The id of the author
 */
exports.doesAuthorExist = async (authorID: string) => {
  const author = await db.get(`globalAuthor:${authorID}`);

  return author != null;
};

/**
 exported for backwards compatibility
 @param {String} authorID The id of the author
  */
exports.doesAuthorExists = exports.doesAuthorExist;


/**
 * Returns the AuthorID for a mapper. We can map using a mapperkey,
 * so far this is token2author and mapper2author
 * @param {String} mapperkey The database key name for this mapper
 * @param {String} mapper The mapper
 */
const mapAuthorWithDBKey = async (mapperkey: string, mapper:string) => {
  // try to map to an author
  const author = await db.get(`${mapperkey}:${mapper}`);

  if (author == null) {
    // there is no author with this mapper, so create one
    const author = await exports.createAuthor(null);

    // create the token2author relation
    await db.set(`${mapperkey}:${mapper}`, author.authorID);

    // return the author
    return author;
  }

  // there is an author with this mapper
  // update the timestamp of this author
  await db.setSub(`globalAuthor:${author}`, ['timestamp'], Date.now());

  // return the author
  return {authorID: author};
};

/**
 * Returns the AuthorID for a token.
 * @param {String} token The token of the author
 * @return {Promise<string|*|{authorID: string}|{authorID: *}>}
 */
const getAuthor4Token = async (token: string) => {
  const author = await mapAuthorWithDBKey('token2author', token);

  // return only the sub value authorID
  return author ? author.authorID : author;
};

/**
 * Returns the AuthorID for a token.
 * @param {String} token
 * @param {Object} user
 * @return {Promise<*>}
 */
exports.getAuthorId = async (token: string, user: object) => {
  const context = {dbKey: token, token, user};
  let [authorId] = await hooks.aCallFirst('getAuthorId', context);
  if (!authorId) authorId = await getAuthor4Token(context.dbKey);
  return authorId;
};

/**
 * Returns the AuthorID for a token.
 *
 * @deprecated Use `getAuthorId` instead.
 * @param {String} token The token
 */
exports.getAuthor4Token = async (token: string) => {
  padutils.warnDeprecated(
      'AuthorManager.getAuthor4Token() is deprecated; use AuthorManager.getAuthorId() instead');
  return await getAuthor4Token(token);
};

/**
 * Returns the AuthorID for a mapper.
 * @param {String} authorMapper The mapper
 * @param {String} name The name of the author (optional)
 */
exports.createAuthorIfNotExistsFor = async (authorMapper: string, name: string) => {
  const author = await mapAuthorWithDBKey('mapper2author', authorMapper);

  if (name) {
    // set the name of this author
    await exports.setAuthorName(author.authorID, name);
  }

  return author;
};


/**
 * Internal function that creates the database entry for an author
 * @param {String} name The name of the author
 */
exports.createAuthor = async (name: string) => {
  const author = `a.${randomString(16)}`;
  const now = Date.now();
  const authorObj = {
    colorId: Math.floor(Math.random() * (exports.getColorPalette().length)),
    name,
    timestamp: now,
    lastSeen: now,
  };
  await db.set(`globalAuthor:${author}`, authorObj);
  return {authorID: author};
};

/**
 * Returns the Author Obj of the author
 * @param {String} author The id of the author
 */
exports.getAuthor = async (author: string) => await db.get(`globalAuthor:${author}`);

/**
 * Returns the color Id of the author
 * @param {String} author The id of the author
 */
exports.getAuthorColorId = async (author: string) => await db.getSub(`globalAuthor:${author}`, ['colorId']);

/**
 * Sets the color Id of the author
 * @param {String} author The id of the author
 * @param {String} colorId The color id of the author
 */
exports.setAuthorColorId = async (author: string, colorId: string) => {
  await db.setSub(`globalAuthor:${author}`, ['colorId'], colorId);
  await db.setSub(`globalAuthor:${author}`, ['lastSeen'], Date.now());
};

/**
 * Returns the name of the author
 * @param {String} author The id of the author
 */
exports.getAuthorName = async (author: string) => await db.getSub(`globalAuthor:${author}`, ['name']);

/**
 * Sets the name of the author
 * @param {String} author The id of the author
 * @param {String} name The name of the author
 */
exports.setAuthorName = async (author: string, name: string) => {
  await db.setSub(`globalAuthor:${author}`, ['name'], name);
  await db.setSub(`globalAuthor:${author}`, ['lastSeen'], Date.now());
};

/**
 * Returns an array of all pads this author contributed to
 * @param {String} authorID The id of the author
 */
exports.listPadsOfAuthor = async (authorID: string) => {
  /* There are two other places where this array is manipulated:
   * (1) When the author is added to a pad, the author object is also updated
   * (2) When a pad is deleted, each author of that pad is also updated
   */

  // get the globalAuthor
  const author = await db.get(`globalAuthor:${authorID}`);

  if (author == null) {
    // author does not exist
    throw new CustomError('authorID does not exist', 'apierror');
  }

  // everything is fine, return the pad IDs
  const padIDs = Object.keys(author.padIDs || {});

  return {padIDs};
};

/**
 * Adds a new pad to the list of contributions
 * @param {String} authorID The id of the author
 * @param {String} padID The id of the pad the author contributes to
 */
exports.addPad = async (authorID: string, padID: string) => {
  // get the entry
  const author = await db.get(`globalAuthor:${authorID}`);

  if (author == null) return;

  /*
   * ACHTUNG: padIDs can also be undefined, not just null, so it is not possible
   * to perform a strict check here
   */
  if (!author.padIDs) {
    // the entry doesn't exist so far, let's create it
    author.padIDs = {};
  }

  // add the entry for this pad
  author.padIDs[padID] = 1; // anything, because value is not used

  // save the new element back
  await db.set(`globalAuthor:${authorID}`, author);
};

/**
 * Removes a pad from the list of contributions
 * @param {String} authorID The id of the author
 * @param {String} padID The id of the pad the author contributes to
 */
exports.removePad = async (authorID: string, padID: string) => {
  const author = await db.get(`globalAuthor:${authorID}`);

  if (author == null) return;

  if (author.padIDs != null) {
    // remove pad from author
    delete author.padIDs[padID];
    await db.set(`globalAuthor:${authorID}`, author);
  }
};

/**
 * GDPR Art. 17: anonymise an author. Zeroes the display identity on
 * `globalAuthor:<authorID>`, deletes the token/mapper bindings that link a
 * person to this authorID, and nulls authorship on chat messages they
 * posted. Leaves pad content, revisions, and attribute pools intact —
 * changeset references are opaque without the identity record, so the
 * link to the real person is severed even though the bytes survive.
 *
 * Idempotent: once `erased: true` is set on the author record, subsequent
 * calls short-circuit and return zero counters.
 */
exports.anonymizeAuthor = async (authorID: string): Promise<{
  affectedPads: number,
  removedTokenMappings: number,
  removedExternalMappings: number,
  clearedChatMessages: number,
}> => {
  // Lazy-require to dodge the AuthorManager ↔ PadManager ↔ Pad cycle.
  const padManager = require('./PadManager');
  const existing = await db.get(`globalAuthor:${authorID}`);
  if (existing == null || existing.erased) {
    return {
      affectedPads: 0,
      removedTokenMappings: 0,
      removedExternalMappings: 0,
      clearedChatMessages: 0,
    };
  }

  // Drop the token/mapper mappings first, before touching anything else, so
  // a concurrent getAuthorId() can no longer resolve this author through
  // its old bindings mid-erasure. These operations are independently
  // idempotent — rerunning a failed call later still produces the same
  // final state, just with zero counters for anything already done.
  let removedTokenMappings = 0;
  const tokenKeys: string[] = await db.findKeys('token2author:*', null);
  for (const key of tokenKeys) {
    if (await db.get(key) === authorID) {
      await db.remove(key);
      removedTokenMappings++;
    }
  }
  let removedExternalMappings = 0;
  const mapperKeys: string[] = await db.findKeys('mapper2author:*', null);
  for (const key of mapperKeys) {
    if (await db.get(key) === authorID) {
      await db.remove(key);
      removedExternalMappings++;
    }
  }

  // Zero the display identity now — without the `erased` sentinel — so a
  // partial run still hides the name. The sentinel itself is only set at
  // the end (below) so a failure in chat scrub lets the next call resume.
  await db.set(`globalAuthor:${authorID}`, {
    colorId: 0,
    name: null,
    timestamp: Date.now(),
    padIDs: existing.padIDs || {},
  });

  // Null authorship on chat messages the author posted. If this throws
  // partway through, the function re-runs the loop on the next call
  // because `erased: true` is not set yet.
  const padIDs = Object.keys(existing.padIDs || {});
  let clearedChatMessages = 0;
  for (const padID of padIDs) {
    if (!await padManager.doesPadExist(padID)) continue;
    const pad = await padManager.getPad(padID);
    const chatHead = pad.chatHead;
    if (typeof chatHead !== 'number' || chatHead < 0) continue;
    for (let i = 0; i <= chatHead; i++) {
      const chatKey = `pad:${padID}:chat:${i}`;
      const msg = await db.get(chatKey);
      if (msg != null && msg.authorId === authorID) {
        msg.authorId = null;
        await db.set(chatKey, msg);
        clearedChatMessages++;
      }
    }
  }

  // Everything succeeded — stamp the sentinel so subsequent calls
  // short-circuit. Merge with the zeroed record we just wrote so padIDs
  // and timestamp persist.
  await db.set(`globalAuthor:${authorID}`, {
    colorId: 0,
    name: null,
    timestamp: Date.now(),
    padIDs: existing.padIDs || {},
    erased: true,
    erasedAt: new Date().toISOString(),
  });

  return {
    affectedPads: padIDs.length,
    removedTokenMappings,
    removedExternalMappings,
    clearedChatMessages,
  };
};
