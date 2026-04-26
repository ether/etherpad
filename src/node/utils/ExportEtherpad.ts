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

import Stream from './Stream.js';
import { strict as assert } from 'assert';
import * as authorManager from '../db/AuthorManager.js';
import hooks from '../../static/js/pluginfw/hooks.js';
import * as padManager from '../db/PadManager.js';

export const getPadRaw = async (padId:string, readOnlyId:string, revNum?: number) => {
  const dstPfx = `pad:${readOnlyId || padId}`;
  const [pad, customPrefixes] = await Promise.all([
    padManager.getPad(padId),
    hooks.aCallAll('exportEtherpadAdditionalContent'),
  ]);
  // If a rev limit was supplied, clamp to it and also clamp chat to the
  // timestamp-ordered window that ended at that rev. Without this, a rev=5
  // export on a pad with head=100 would still ship all 95 later revisions
  // (and leak their content via the exported .etherpad file) — which is
  // precisely what issue #5071 reported.
  const padHead: number = pad.head;
  const effectiveHead: number = (revNum == null || revNum > padHead) ? padHead : revNum;
  const isRevBound = revNum != null && revNum < padHead;
  const boundAtext = isRevBound ? await pad.getInternalRevisionAText(effectiveHead) : null;
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
    for (let i = 0; i <= effectiveHead; ++i) yield [`${dstPfx}:revs:${i}`, pad.getRevision(i)];
    for (let i = 0; i <= pad.chatHead; ++i) yield [`${dstPfx}:chat:${i}`, pad.getChatMessage(i)];
    for (const gen of pluginRecords) yield* gen;
  })();
  // When rev-bound, serialize a shallow-cloned pad object with head/atext
  // rewritten so the import side reconstructs the pad at the requested rev.
  // toJSON() returns a plain object suitable for spreading; the live Pad
  // instance is kept for the exportEtherpad hook below.
  const serializedPad = isRevBound
      ? {...(pad.toJSON()), head: effectiveHead, atext: boundAtext}
      : pad;
  const data = {[dstPfx]: serializedPad};
  for (const [dstKey, p] of new Stream(records).batch(100).buffer(99)) data[dstKey] = await p;
  await hooks.aCallAll('exportEtherpad', {
    pad,
    data,
    dstPadId: readOnlyId || padId,
  });
  return data;
};
