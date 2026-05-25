'use strict';

import {APool} from "../types/PadType.js";

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

import AttributeMap from '../../static/js/AttributeMap.js';
import AttributePool from '../../static/js/AttributePool.js';
import {applyToAText, cloneAText, deserializeOps, makeAText, pack, unpack} from '../../static/js/Changeset.js';
import {SmartOpAssembler} from '../../static/js/SmartOpAssembler.js';
import { Pad } from '../db/Pad.js';
import Stream from './Stream.js';
import * as authorManager from '../db/AuthorManager.js';
import db from '../db/DB.js';
import hooks from '../../static/js/pluginfw/hooks.js';
import log4js from 'log4js';
import { supportedElems } from '../../static/js/contentcollector.js';
import {Database} from 'ueberdb2';

const logger = log4js.getLogger('ImportEtherpad');

// Mirror of `Pad.SYSTEM_AUTHOR_ID`. Inlined to avoid a circular import
// (ImportEtherpad -> Pad -> ImportEtherpad via padManager) at module
// init time.
const SYSTEM_AUTHOR_ID = 'a.etherpad-system';

// A `+` op is "pure newline" (and therefore exempt from the author
// requirement) iff every character in the op is a newline. The wire-
// boundary guard in Pad._assertInsertOpsCarryAuthor whitelists the
// same shape; mirror it here so the sanitiser doesn't touch ops the
// downstream guard would have accepted anyway.
const isPureNewlineInsert = (op: {lines: number, chars: number}) =>
    op.lines > 0 && op.chars === op.lines;

// Walk a serialized ops string (changeset ops *or* an atext.attribs
// stream — both use the same encoding), inject the `author` attribute
// on any `+` content op that lacks one, and return the rebuilt ops
// string plus the number of ops that were rewritten.
//
// `pool` is the AttributePool that the ops reference, and is mutated
// in-place to register the system author when needed. The caller is
// responsible for persisting the (possibly mutated) pool back to the
// record alongside the rewritten ops string.
const sanitiseOpsString = (
    opsStr: string, pool: AttributePool): {ops: string, rewrites: number} => {
  const assem = new SmartOpAssembler();
  let rewrites = 0;
  let touched = false;
  for (const op of deserializeOps(opsStr)) {
    if (op.opcode === '+' && !isPureNewlineInsert(op)) {
      const map = AttributeMap.fromString(op.attribs, pool);
      if (!map.get('author')) {
        map.set('author', SYSTEM_AUTHOR_ID);
        op.attribs = map.toString();
        rewrites++;
        touched = true;
      }
    }
    assem.append(op);
  }
  assem.endDocument();
  // Even when nothing was rewritten, re-serializing through the
  // assembler is safe (it produces canonical form). But to keep the
  // diff minimal on clean inputs, return the original string when
  // nothing actually changed.
  if (!touched) return {ops: opsStr, rewrites: 0};
  return {ops: assem.toString(), rewrites};
};

// Sanitise an entire changeset: unpack -> rewrite ops -> repack.
// oldLen / newLen / charBank are preserved as-is because adding
// author markers doesn't change op.chars or the character stream.
const sanitiseChangeset = (
    cs: string, pool: AttributePool): {cs: string, rewrites: number} => {
  let unpacked;
  try {
    unpacked = unpack(cs);
  } catch {
    // Not a parseable changeset — leave it alone and let the
    // downstream consumer surface the original error.
    return {cs, rewrites: 0};
  }
  const {ops, rewrites} = sanitiseOpsString(unpacked.ops, pool);
  if (rewrites === 0) return {cs, rewrites: 0};
  return {cs: pack(unpacked.oldLen, unpacked.newLen, ops, unpacked.charBank), rewrites};
};

// Top-level pre-pass: walks the imported `records` dict, sanitises any
// `+` content op (across all revisions) that lacks an `author`
// attribute, and re-derives the cumulative head atext and any
// key-revision meta.atext / meta.pool snapshots so they stay
// consistent with the rewritten revs. Without re-derivation, the
// `Pad.check()` deep-equal that runs at the end of `setPadRaw` would
// see a sanitised head atext (or sanitised key-rev snapshot) whose
// attribute numbers don't agree with the sanitised running atext
// computed from the (separately-sanitised) revs.
//
// Returns the number of ops rewritten across the whole pad (0 means
// the import was already conforming and nothing was touched).
//
// Mutates `records` in place. The caller passes the original-padId-
// keyed records dict (i.e. the post-JSON.parse state, BEFORE the
// destination padId rewrite happens in processRecord).
const sanitiseImportedRecords = (
    records: Record<string, any>, srcPadId: string): number => {
  const padKey = `pad:${srcPadId}`;
  const padRec = records[padKey];
  if (!padRec || !padRec.pool) return 0;

  // Collect rev records in numeric order. We process them
  // sequentially so we can re-apply each (post-sanitisation)
  // changeset to a running atext and refresh key-rev snapshots
  // along the way.
  const escPadId = srcPadId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const revKeyRe = new RegExp(`^pad:${escPadId}:revs:(\\d+)$`);
  const revs: Array<{n: number, rec: any}> = [];
  for (const [k, v] of Object.entries(records)) {
    const m = k.match(revKeyRe);
    if (m && v) revs.push({n: Number(m[1]), rec: v});
  }
  revs.sort((a, b) => a.n - b.n);
  if (revs.length === 0) return 0;

  // Start the running atext at the canonical empty pad and the
  // cumulative pool at whatever the imported padRec.pool was — the
  // latter already contains every attribute that the rev changesets
  // reference, so deserialising rev ops against it always resolves.
  // The pool grows in place when sanitiseOpsString needs to register
  // SYSTEM_AUTHOR_ID; that's exactly what we want the final
  // padRec.pool to look like.
  const cumulativePool = new AttributePool().fromJsonable(padRec.pool);
  let runningAText = makeAText('\n');
  let totalRewrites = 0;

  for (const {rec} of revs) {
    if (typeof rec.changeset !== 'string') continue;
    const {cs, rewrites} = sanitiseChangeset(rec.changeset, cumulativePool);
    if (rewrites > 0) rec.changeset = cs;
    totalRewrites += rewrites;

    // Walk the (possibly rewritten) changeset against the running
    // atext to keep it in lock-step. applyToAText also serves as
    // an in-pass sanity check — if a sanitised changeset doesn't
    // apply cleanly the import dies here instead of silently
    // corrupting state.
    runningAText = applyToAText(rec.changeset, runningAText, cumulativePool);

    // If the imported rev carried a key-rev snapshot (meta.atext /
    // meta.pool), replace it with the post-sanitisation running
    // state. We *always* refresh when totalRewrites > 0 for this
    // pad — and we always refresh the snapshot of *this* rev when
    // the snapshot was present in the import (cheaper than figuring
    // out exactly which key-revs were affected by the rewrite).
    if (rec.meta && (rec.meta.pool || rec.meta.atext)) {
      rec.meta.pool = cumulativePool.toJsonable();
      rec.meta.atext = cloneAText(runningAText);
    }
  }

  // Refresh the head atext and pad pool. Same rationale as the
  // key-rev refresh above.
  if (totalRewrites > 0) {
    padRec.atext = cloneAText(runningAText);
    padRec.pool = cumulativePool.toJsonable();
  }
  return totalRewrites;
};

export const setPadRaw = async (padId: string, r: string, authorId = '') => {
  const records = JSON.parse(r);

  // Sanitiser pre-pass: legacy .etherpad files (and exports from older
  // server-internal flows that didn't substitute SYSTEM_AUTHOR_ID)
  // can contain `+` content ops without an `author` attribute. The
  // wire boundary and Pad.appendRevision now reject that shape, so a
  // post-import setText/setHTML/restoreRevision against an imported
  // pad would throw. Rewrite the imported records up-front to inject
  // the system author marker on any unattributed insert, mutating the
  // pad pool (and any per-key-rev snapshot pool) to register the
  // attribute. Discover the source pad id by scanning record keys:
  // pre-rewrite they still use the original padId.
  let srcPadId: string | null = null;
  for (const k of Object.keys(records)) {
    const parts = k.split(':');
    if (parts[0] === 'pad' && parts.length >= 2) {
      srcPadId = parts[1];
      break;
    }
  }
  if (srcPadId != null) {
    const rewritten = sanitiseImportedRecords(records, srcPadId);
    if (rewritten > 0) {
      logger.warn(
          `(pad ${padId}) import contained ${rewritten} unattributed insert ` +
          `op(s); rewriting them with the system author to satisfy the ` +
          `appendRevision invariant. Source pad id: ${srcPadId}.`);
    }
  }

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
