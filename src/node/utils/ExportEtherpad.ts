'use strict';
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

const Stream = require('./Stream');
const assert = require('assert').strict;
const authorManager = require('../db/AuthorManager');
const hooks = require('../../static/js/pluginfw/hooks');
const padManager = require('../db/PadManager');

exports.getPadRaw = async (padId:string, readOnlyId:string) => {
  const dstPfx = `pad:${readOnlyId || padId}`;
  const [pad, customPrefixes] = await Promise.all([
    padManager.getPad(padId),
    hooks.aCallAll('exportEtherpadAdditionalContent'),
  ]);
  const pluginRecords = await Promise.all(customPrefixes.map(async (customPrefix:string) => {
    const srcPfx = `${customPrefix}:${padId}`;
    const dstPfx = `${customPrefix}:${readOnlyId || padId}`;
    assert(!srcPfx.includes('*'));
    const srcKeys = await pad.db.findKeys(`${srcPfx}:*`, null);
    return (function* () {
      yield [dstPfx, pad.db.get(srcPfx)];
      for (const k of srcKeys) {
        assert(k.startsWith(`${srcPfx}:`));
        yield [`${dstPfx}${k.slice(srcPfx.length)}`, pad.db.get(k)];
      }
    })();
  }));
  const records = (function* () {
    for (const authorId of pad.getAllAuthors()) {
      yield [`globalAuthor:${authorId}`, (async () => {
        const authorEntry = await authorManager.getAuthor(authorId);
        if (!authorEntry) return undefined; // Becomes unset when converted to JSON.
        if (authorEntry.padIDs) authorEntry.padIDs = readOnlyId || padId;
        return authorEntry;
      })()];
    }
    for (let i = 0; i <= pad.head; ++i) yield [`${dstPfx}:revs:${i}`, pad.getRevision(i)];
    for (let i = 0; i <= pad.chatHead; ++i) yield [`${dstPfx}:chat:${i}`, pad.getChatMessage(i)];
    for (const gen of pluginRecords) yield* gen;
  })();
  const data = {[dstPfx]: pad};
  for (const [dstKey, p] of new Stream(records).batch(100).buffer(99)) data[dstKey] = await p;
  await hooks.aCallAll('exportEtherpad', {
    pad,
    data,
    dstPadId: readOnlyId || padId,
  });
  return data;
};
