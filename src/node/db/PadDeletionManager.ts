'use strict';

import crypto from 'node:crypto';
import randomString from '../utils/randomstring';

const DB = require('./DB');

const getDeletionTokenKey = (padId: string) => `pad:${padId}:deletionToken`;

const hashDeletionToken = (deletionToken: string) =>
  crypto.createHash('sha256').update(deletionToken, 'utf8').digest();

// Per-pad serialisation for token creation. Without this, two concurrent
// `createDeletionTokenIfAbsent()` calls for the same pad can both observe
// an empty slot, both write a hash, and leave the earlier caller holding a
// plaintext token that no longer validates. The chain is cleaned up once the
// outstanding call resolves so this map doesn't grow unbounded.
const inflightCreate: Map<string, Promise<string | null>> = new Map();

exports.createDeletionTokenIfAbsent = async (padId: string): Promise<string | null> => {
  const prior = inflightCreate.get(padId);
  const next = (prior || Promise.resolve()).then(async () => {
    if (await DB.db.get(getDeletionTokenKey(padId)) != null) return null;
    const deletionToken = randomString(32);
    await DB.db.set(getDeletionTokenKey(padId), {
      createdAt: Date.now(),
      hash: hashDeletionToken(deletionToken).toString('hex'),
    });
    return deletionToken;
  });
  const tracked = next.finally(() => {
    if (inflightCreate.get(padId) === tracked) inflightCreate.delete(padId);
  });
  inflightCreate.set(padId, tracked);
  return next;
};

exports.isValidDeletionToken = async (padId: string, deletionToken: string | null | undefined) => {
  if (typeof deletionToken !== 'string' || deletionToken === '') return false;
  const storedToken = await DB.db.get(getDeletionTokenKey(padId));
  if (storedToken == null || typeof storedToken.hash !== 'string') return false;
  const expected = Buffer.from(storedToken.hash, 'hex');
  const actual = hashDeletionToken(deletionToken);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
};

exports.removeDeletionToken = async (padId: string) =>
  await DB.db.remove(getDeletionTokenKey(padId));
