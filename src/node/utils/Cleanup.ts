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
  await pad.check()

  logger.debug('Initial pad is valid')

  if (pad.head <= keepRevisions) {
    logger.debug('Pad has not enough revisions')
    return false
  }

  padMessageHandler.kickSessionsFromPad(padId)

  try {
    return await rebuildHistory(pad, padId, keepRevisions)
  } finally {
    // Always drop the cached Pad, success or failure. It still carries the
    // pre-cleanup head, and if cleanup failed after the pad record was
    // rewritten, an edit through that stale object would append at the OLD
    // head -- persisting a head far past the rebuilt history and punching a
    // run of holes that no later cleanup can repair. See #8134.
    padManager.unloadPad(padId);
  }
}

const rebuildHistory = async (pad: any, padId: string, keepRevisions: number): Promise<boolean> => {
  const cleanupUntilRevision = pad.head - keepRevisions
  logger.debug('Composing changesets: ', cleanupUntilRevision)
  const changeset = await padMessageHandler.composePadChangesets(pad, 0, cleanupUntilRevision + 1)

  const revisions: Revision[] = [];

  await timesLimit(keepRevisions + 1, 500, async (i: number) => {
    const rev = i + cleanupUntilRevision
    revisions[rev] = await pad.getRevision(rev)
  });

  logger.debug('Loaded revisions: ', revisions.length)

  const oldHead = pad.head

  // Order matters. This used to remove every revision 0..head first and only
  // then write the replacements, so any failure in that window left the pad
  // with holes -- or with no history at all -- while the pad record still
  // claimed them. Instead: write the rebuilt history, then move head onto it,
  // then drop what is left over.
  //
  // Overwriting revisions 0..keepRevisions in place is safe because
  // everything needed to rebuild them is already in memory above
  // (`changeset` and `revisions`); nothing is read back from those keys.

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

  // The rebuilt history is durable; point the pad at it.
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

  // Only now drop the revisions the new head no longer references. These are
  // orphans: check() walks 0..head, so if this part fails it wastes space
  // without making the pad inconsistent.
  if (oldHead > keepRevisions) {
    await timesLimit(oldHead - keepRevisions, 500, async (i: number) => {
      await db.remove(`pad:${padId}:revs:${keepRevisions + 1 + i}`, null);
    });
  }

  logger.debug('Finished migration. Checking pad now')

  // Drop the cached Pad before re-reading: it still carries the pre-cleanup
  // head, and verifying against that would walk revisions this cleanup just
  // removed. (The caller's `finally` unloads it again; this one has to happen
  // here so the verification below reads from storage.)
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
