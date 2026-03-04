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
  // create the new author name
  const author = `a.${randomString(16)}`;

  // create the globalAuthors db entry
  const authorObj = {
    colorId: Math.floor(Math.random() * (exports.getColorPalette().length)),
    name,
    timestamp: Date.now(),
  };

  // set the global author db entry
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
exports.setAuthorColorId = async (author: string, colorId: string) => await db.setSub(
    `globalAuthor:${author}`, ['colorId'], colorId);

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
exports.setAuthorName = async (author: string, name: string) => await db.setSub(
    `globalAuthor:${author}`, ['name'], name);

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
