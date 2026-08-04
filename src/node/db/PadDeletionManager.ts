'use strict';

import crypto from 'node:crypto';
import randomString from '../utils/randomstring';

const DB = require('./DB');

const getDeletionTokenKey = (padId: string) => `pad:${padId}:deletionToken`;

const hashDeletionToken = (deletionToken: string) =>
  crypto.createHash('sha256').update(deletionToken, 'utf8').digest();

// Per-pad serialisation for the read-then-write token paths. Without this, two
// concurrent `createDeletionTokenIfAbsent()` calls for the same pad can both
// observe an empty slot, both write a hash, and leave the earlier caller holding
// a plaintext token that no longer validates. `transferDeletionToken()` shares
// the queue because it is the same read-then-write against the same slot. The
// chain is cleaned up once the outstanding call resolves so this map doesn't
// grow unbounded.
const inflight: Map<string, Promise<any>> = new Map();

const withPadTokenLock = <T>(padId: string, fn: () => Promise<T>): Promise<T> => {
  const prior = inflight.get(padId);
  const next = (prior || Promise.resolve()).then(fn);
  const tracked = next.finally(() => {
    if (inflight.get(padId) === tracked) inflight.delete(padId);
  });
  inflight.set(padId, tracked);
  return next;
};

exports.createDeletionTokenIfAbsent = async (padId: string): Promise<string | null> =>
  await withPadTokenLock(padId, async () => {
    if (await DB.db.get(getDeletionTokenKey(padId)) != null) return null;
    const deletionToken = randomString(32);
    await DB.db.set(getDeletionTokenKey(padId), {
      createdAt: Date.now(),
      hash: hashDeletionToken(deletionToken).toString('hex'),
    });
    return deletionToken;
  });

exports.isValidDeletionToken = async (padId: string, deletionToken: string | null | undefined) => {
  if (typeof deletionToken !== 'string' || deletionToken === '') return false;
  const storedToken = await DB.db.get(getDeletionTokenKey(padId));
  if (storedToken == null || typeof storedToken.hash !== 'string') return false;
  const expected = Buffer.from(storedToken.hash, 'hex');
  const actual = hashDeletionToken(deletionToken);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
};

// Hand the token over to a renamed pad. A move is the same pad under a new id,
// so the token the creator was told to save must keep working there — and they
// must not be prompted to save a second one on arrival (issue #7995). Only
// movePad uses this: copyPad's destination is a separate pad, and two pads
// sharing one secret would let a token saved for one delete the other.
//
// The source record is deliberately left in place — the caller's `Pad.remove()`
// drops it as part of the move. Removing it here would strand the creator of a
// source pad that survives a failed `remove()`.
exports.transferDeletionToken = async (srcPadId: string, dstPadId: string) =>
  await withPadTokenLock(dstPadId, async () => {
    const stored = await DB.db.get(getDeletionTokenKey(srcPadId));
    // Nothing to hand over: the instance suppresses tokens, or the pad predates
    // them. Leave the destination alone — a force-overwrite has already dropped
    // the replaced pad's token via Pad.remove().
    if (stored == null) return;
    // Never clobber a token the destination has already handed out in plaintext.
    // If the creator opened the new id in the window between Pad.copy() writing
    // the pad records and this transfer, they were shown a freshly minted token
    // and that one has to keep working; they simply keep it instead of the
    // source's.
    if (await DB.db.get(getDeletionTokenKey(dstPadId)) != null) return;
    await DB.db.set(getDeletionTokenKey(dstPadId), stored);
  });

exports.removeDeletionToken = async (padId: string) =>
  await DB.db.remove(getDeletionTokenKey(padId));
