/*
  This is a repair tool. It rebuilds an old pad at a new pad location up to a
  known "good" revision.
*/

// As of v14, Node.js does not exit when there is an unhandled Promise rejection. Convert an
// unhandled rejection into an uncaught exception, which does cause Node.js to exit.
import process from "node:process";

process.on('unhandledRejection', (err) => { throw err; });

if (process.argv.length !== 4 && process.argv.length !== 5) {
  throw new Error('Use: node bin/repairPad.js $PADID $REV [$NEWPADID]');
}

// @ts-ignore
const padId = process.argv[2];
const newRevHead = Number(process.argv[3]);
const newPadId = process.argv[4] || `${padId}-rebuilt`;

(async () => {
  const db = require('ep_etherpad-lite/node/db/DB');
  await db.init();

  const PadManager = require('ep_etherpad-lite/node/db/PadManager');
  const Pad = require('ep_etherpad-lite/node/db/Pad').Pad;
  // Validate the newPadId if specified and that a pad with that ID does
  // not already exist to avoid overwriting it.
  if (!PadManager.isValidPadId(newPadId)) {
    throw new Error('Cannot create a pad with that id as it is invalid');
  }
  const exists = await PadManager.doesPadExist(newPadId);
  if (exists) throw new Error('Cannot create a pad with that id as it already exists');

  const oldPad = await PadManager.getPad(padId);
  const newPad = new Pad(newPadId);

  // Clone all Chat revisions
  const chatHead = oldPad.chatHead;
  await Promise.all([...Array(chatHead + 1).keys()].map(async (i) => {
    const chat = await db.get(`pad:${padId}:chat:${i}`);
    await db.set(`pad:${newPadId}:chat:${i}`, chat);
    console.log(`Created: Chat Revision: pad:${newPadId}:chat:${i}`);
  }));

  // Rebuild Pad from revisions up to and including the new revision head
  const AuthorManager = require('ep_etherpad-lite/node/db/AuthorManager');
  const Changeset = require('ep_etherpad-lite/static/js/Changeset');
  // Author attributes are derived from changesets, but there can also be
  // non-author attributes with specific mappings that changesets depend on
  // and, AFAICT, cannot be recreated any other way
  newPad.pool.numToAttrib = oldPad.pool.numToAttrib;
  for (let curRevNum = 0; curRevNum <= newRevHead; curRevNum++) {
    const rev = await db.get(`pad:${padId}:revs:${curRevNum}`);
    if (!rev || !rev.meta) throw new Error('The specified revision number could not be found.');
    const newRevNum = ++newPad.head;
    const newRevId = `pad:${newPad.id}:revs:${newRevNum}`;
    await Promise.all([
      db.set(newRevId, rev),
      AuthorManager.addPad(rev.meta.author, newPad.id),
    ]);
    newPad.atext = Changeset.applyToAText(rev.changeset, newPad.atext, newPad.pool);
    console.log(`Created: Revision: pad:${newPad.id}:revs:${newRevNum}`);
  }

  // Add saved revisions up to the new revision head
  console.log(newPad.head);
  const newSavedRevisions = [];
  for (const savedRev of oldPad.savedRevisions) {
    if (savedRev.revNum <= newRevHead) {
      newSavedRevisions.push(savedRev);
      console.log(`Added: Saved Revision: ${savedRev.revNum}`);
    }
  }
  newPad.savedRevisions = newSavedRevisions;

  // Save the source pad
  await db.set(`pad:${newPadId}`, newPad);

  console.log(`Created: Source Pad: pad:${newPadId}`);
  await newPad.saveToDatabase();

  await db.shutdown();
  console.info('finished');
  process.exit(0)
})();
