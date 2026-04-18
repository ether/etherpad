'use strict';

import crypto from 'node:crypto';
import randomString from '../utils/randomstring';

const db = require('./DB').db;

const getDeletionTokenKey = (padId: string) => `pad:${padId}:deletionToken`;

const hashDeletionToken = (deletionToken: string) =>
  crypto.createHash('sha256').update(deletionToken, 'utf8').digest();

exports.createDeletionTokenIfAbsent = async (padId: string): Promise<string | null> => {
  if (await db.get(getDeletionTokenKey(padId)) != null) return null;
  const deletionToken = randomString(32);
  await db.set(getDeletionTokenKey(padId), {
    createdAt: Date.now(),
    hash: hashDeletionToken(deletionToken).toString('hex'),
  });
  return deletionToken;
};

exports.isValidDeletionToken = async (padId: string, deletionToken: string | null | undefined) => {
  if (typeof deletionToken !== 'string' || deletionToken === '') return false;
  const storedToken = await db.get(getDeletionTokenKey(padId));
  if (storedToken == null || typeof storedToken.hash !== 'string') return false;
  const expected = Buffer.from(storedToken.hash, 'hex');
  const actual = hashDeletionToken(deletionToken);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
};

exports.removeDeletionToken = async (padId: string) => await db.remove(getDeletionTokenKey(padId));
