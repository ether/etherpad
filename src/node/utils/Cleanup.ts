'use strict'

import {AChangeSet} from "../types/PadType";
import {Revision} from "../types/Revision";

import {timesLimit, firstSatisfies} from './promises';
const padManager = require('ep_etherpad-lite/node/db/PadManager');
const db = require('ep_etherpad-lite/node/db/DB');
const Changeset = require('ep_etherpad-lite/static/js/Changeset');
const padMessageHandler = require('ep_etherpad-lite/node/handler/PadMessageHandler');
import log4js from 'log4js';
const logger = log4js.getLogger('cleanup');


export const deleteAllRevisions = async (padID: string): Promise<void> => {

  const randomPadId = padID + 'aertdfdf' + Math.random().toString(10)

  let pad = await padManager.getPad(padID);
  await pad.copyPadWithoutHistory(randomPadId, false);
  pad = await padManager.getPad(randomPadId);
  await pad.copyPadWithoutHistory(padID, true);
  await pad.remove();
}

const createRevision = async (aChangeset: AChangeSet, timestamp: number, isKeyRev: boolean, authorId: string, atext: any, pool: any) => {

  if (authorId !== '') pool.putAttrib(['author', authorId]);

  return {
    changeset: aChangeset,
    meta: {
      author: authorId,
      timestamp: timestamp,
      ...isKeyRev ? {
        pool: pool,
        atext: atext,
      } : {},
    },
  };
}

export const deleteRevisions = async (padId: string, keepRevisions: number): Promise<boolean> => {

  logger.debug('Start cleanup revisions', padId)

  let pad = await padManager.getPad(padId);

  // Report a damaged history as a damaged history. check() detects it too,
  // but only as `assert(timestamp != null)` part-way through replaying the
  // revisions, which tells an operator nothing about which record is bad or
  // what to do about it. See #8134.
  const missing = await pad.findMissingRevisions();
  if (missing.length > 0) {
    throw new Error(
        `Pad ${padId} is missing revision(s) ${missing.join(', ')}` +
        `${missing.length >= 20 ? ' (and possibly more)' : ''}. ` +
        'Its history cannot be replayed, so revisions cannot be cleaned up. ' +
        "The pad's current text is unaffected. Rebuild the history with a " +
        'full compaction (compactPad with no keepRevisions) to make the pad ' +
        'cleanable again.');
  }

  await pad.check()

  logger.debug('Initial pad is valid')

  if (pad.head <= keepRevisions) {
    logger.debug('Pad has not enough revisions')
    return false
  }

  padMessageHandler.kickSessionsFromPad(padId)

  const cleanupUntilRevision = pad.head - keepRevisions
  logger.debug('Composing changesets: ', cleanupUntilRevision)
  const changeset = await padMessageHandler.composePadChangesets(pad, 0, cleanupUntilRevision + 1)

  const revisions: Revision[] = [];

  await timesLimit(keepRevisions + 1, 500, async (i: number) => {
    const rev = i + cleanupUntilRevision
    revisions[rev] = await pad.getRevision(rev)
  });

  logger.debug('Loaded revisions: ', revisions.length)

  await timesLimit(pad.head + 1, 500, async (i: string) => {
    await db.remove(`pad:${padId}:revs:${i}`, null);
  });

  let padContent = await db.get(`pad:${padId}`)
  padContent.head = keepRevisions
  if (padContent.savedRevisions) {
    let newSavedRevisions = []

    for (let i = 0; i < padContent.savedRevisions.length; i++) {
      if (padContent.savedRevisions[i].revNum > cleanupUntilRevision) {
        padContent.savedRevisions[i].revNum = padContent.savedRevisions[i].revNum - cleanupUntilRevision
        newSavedRevisions.push(padContent.savedRevisions[i])
      }
    }
    padContent.savedRevisions = newSavedRevisions
  }
  await db.set(`pad:${padId}`, padContent);

  let newAText = Changeset.makeAText('\n');
  let pool = pad.apool()

  newAText = Changeset.applyToAText(changeset, newAText, pool);

  const revision = await createRevision(
    changeset,
    revisions[cleanupUntilRevision].meta.timestamp,
    0 === pad.getKeyRevisionNumber(0),
    '',
    newAText,
    pool
  );

  const p: Promise<void>[] = [];

  p.push(db.set(`pad:${padId}:revs:0`, revision))

  p.push(timesLimit(keepRevisions, 500, async (i: number) => {
    const rev = i + cleanupUntilRevision + 1
    const newRev = rev - cleanupUntilRevision;

    newAText = Changeset.applyToAText(revisions[rev].changeset, newAText, pool);

    const revision = await createRevision(
      revisions[rev].changeset,
      revisions[rev].meta.timestamp,
      newRev === pad.getKeyRevisionNumber(newRev),
      revisions[rev].meta.author,
      newAText,
      pool
    );

    await db.set(`pad:${padId}:revs:${newRev}`, revision);
  }));

  await Promise.all(p)

  logger.debug('Finished migration. Checking pad now')

  padManager.unloadPad(padId);

  let newPad = await padManager.getPad(padId);
  await newPad.check();

  return true
}

export const checkTodos = async () => {
  await new Promise(resolve => setTimeout(resolve, 5000));

  // TODO: Move to settings
  const settings = {
    minHead: 100,
    keepRevisions: 100,
    minAge: 1,//1000 * 60 * 60 * 24,
  }

  await Promise.all((await padManager.listAllPads()).padIDs.map(async (padId: string) => {
    // TODO: Handle concurrency
    const pad = await padManager.getPad(padId);

    const revisionDate = await pad.getRevisionDate(pad.getHeadRevisionNumber())

    if (pad.head < settings.minHead || padMessageHandler.padUsersCount(padId) > 0 || Date.now() < revisionDate + settings.minAge) {
      return
    }

    try {
      const result = await deleteRevisions(padId, settings.keepRevisions)
      if (result) {
        logger.info('successful cleaned up pad: ', padId)
      }
    } catch (err: any) {
      logger.error(`Error in pad ${padId}: ${err.stack || err}`);
      return;
    }
  }));
}
