'use strict';

import {APool} from "../types/PadType";

/**
 * 2014 John McLear (Etherpad Foundation / McLear Ltd)
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

import AttributePool from '../../static/js/AttributePool';
const {Pad} = require('../db/Pad');
const Stream = require('./Stream');
const authorManager = require('../db/AuthorManager');
const db = require('../db/DB');
const hooks = require('../../static/js/pluginfw/hooks');
import log4js from 'log4js';
const supportedElems = require('../../static/js/contentcollector').supportedElems;
import {Database} from 'ueberdb2';

const logger = log4js.getLogger('ImportEtherpad');

exports.setPadRaw = async (padId: string, r: string, authorId = '') => {
  const records = JSON.parse(r);

  // get supported block Elements from plugins, we will use this later.
  hooks.callAll('ccRegisterBlockElements').forEach((element:any) => {
    supportedElems.add(element);
  });

  // DB key prefixes for pad records. Each key is expected to have the form `${prefix}:${padId}` or
  // `${prefix}:${padId}:${otherstuff}`.
  const padKeyPrefixes = [
    ...await hooks.aCallAll('exportEtherpadAdditionalContent'),
    'pad',
  ];

  let originalPadId:string|null = null;
  const checkOriginalPadId = (padId: string) => {
    if (originalPadId == null) originalPadId = padId;
    if (originalPadId !== padId) throw new Error('unexpected pad ID in record');
  };

  // First validate and transform values. Do not commit any records to the database yet in case
  // there is a problem with the data.

  const data = new Map();
  const existingAuthors = new Set();
  const padDb = new Database('memory', {data});
  await padDb.init();
  try {
    const processRecord = async (key:string, value: null|{
      padIDs: string|Record<string, unknown>,
      pool: AttributePool
    }) => {
      if (!value) return;
      const keyParts = key.split(':');
      const [prefix, id] = keyParts;
      if (prefix === 'globalAuthor' && keyParts.length === 2) {
        // In the database, the padIDs subkey is an object (which is used as a set) that records
        // every pad the author has worked on. When exported, that object becomes a single string
        // containing the exported pad's ID.
        if (typeof value.padIDs !== 'string') {
          throw new TypeError('globalAuthor padIDs subkey is not a string');
        }
        checkOriginalPadId(value.padIDs);
        if (await authorManager.doesAuthorExist(id)) {
          existingAuthors.add(id);
          return;
        }
        value.padIDs = {[padId]: 1};
      } else if (padKeyPrefixes.includes(prefix)) {
        checkOriginalPadId(id);
        if (prefix === 'pad' && keyParts.length === 2) {
          const pool = new AttributePool().fromJsonable(value.pool);
          const unsupportedElements = new Set();
          pool.eachAttrib((k: string, v:any) => {
            if (!supportedElems.has(k)) unsupportedElements.add(k);
          });
          if (unsupportedElements.size) {
            logger.warn(`(pad ${padId}) unsupported attributes (try installing a plugin): ` +
                        `${[...unsupportedElements].join(', ')}`);
          }
        }
        keyParts[1] = padId;
        key = keyParts.join(':');
      } else {
        logger.debug(`(pad ${padId}) The record with the following key will be ignored unless an ` +
                     `importEtherpad hook function processes it: ${key}`);
        return;
      }
      // @ts-ignore
      await padDb.set(key, value);
    };
    // @ts-ignore
    const readOps = new Stream(Object.entries(records)).map(([k, v]) => processRecord(k, v));
    for (const op of readOps.batch(100).buffer(99)) await op;

    const pad = new Pad(padId, padDb);
    await pad.init(null, authorId);
    await hooks.aCallAll('importEtherpad', {
      pad,
      // Shallow freeze meant to prevent accidental bugs. It would be better to deep freeze, but
      // it's not worth the added complexity.
      data: Object.freeze(records),
      srcPadId: originalPadId,
    });
    await pad.check();
  } finally {
    await padDb.close();
  }

  const writeOps = (function* () {
    for (const [k, v] of data) yield db.set(k, v);
    for (const a of existingAuthors) yield authorManager.addPad(a, padId);
  })();
  for (const op of new Stream(writeOps).batch(100).buffer(99)) await op;
};
