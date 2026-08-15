'use strict';

// Regression coverage for #8134.
//
// `pad.check()` prefixes failures with `(pad <id> revision <n>)` so admins
// know which record is bad. Everything that reports a failed check logs
// `err.stack`, which is rendered from the message at construction time --
// so assigning to `err.message` alone left the stack (and therefore the
// log) showing the context-free text. The reporter on #8134 had to bisect
// their database by hand to find the offending revision.

const assert = require('assert').strict;
const common = require('../common');
const padManager = require('../../../node/db/PadManager');
const db = require('../../../node/db/DB');
const {deleteRevisions} = require('../../../node/utils/Cleanup');
const settings = require('../../../node/utils/Settings');

describe(__filename, function () {
  let padId: string;
  let cleanupEnabledBackup: boolean;

  before(async function () {
    await common.init();
    cleanupEnabledBackup = settings.cleanup.enabled;
    settings.cleanup.enabled = true;
  });

  after(function () { settings.cleanup.enabled = cleanupEnabledBackup; });

  beforeEach(async function () {
    padId = common.randomString();
    assert(!await padManager.doesPadExist(padId));
  });

  // Produces the shape reported in #8134: `head` points past a revision
  // whose `pad:<id>:revs:<n>` record is absent.
  const padWithMissingRevision = async (missingRev: number) => {
    const pad = await padManager.getPad(padId);
    for (let i = 0; i < 6; i++) await pad.appendText(`line ${i}\n`);
    assert.ok(pad.getHeadRevisionNumber() > missingRev);
    await db.remove(`pad:${padId}:revs:${missingRev}`, null);
    padManager.unloadPad(padId);
    return await padManager.getPad(padId);
  };

  describe('a missing revision', function () {
    it('makes check() throw', async function () {
      const pad = await padWithMissingRevision(3);
      await assert.rejects(pad.check());
    });

    it('names the pad and revision in err.message', async function () {
      const pad = await padWithMissingRevision(3);
      const err: any = await pad.check().then(() => null, (e: any) => e);
      assert.ok(err != null, 'expected check() to throw');
      assert.match(err.message, new RegExp(`\\(pad ${padId} revision 3\\)`));
    });

    it('names the pad and revision in err.stack too', async function () {
      // This is what the admin handler and Cleanup.checkTodos actually log.
      const pad = await padWithMissingRevision(3);
      const err: any = await pad.check().then(() => null, (e: any) => e);
      assert.ok(err != null, 'expected check() to throw');
      assert.match(err.stack, new RegExp(`\\(pad ${padId} revision 3\\)`),
          `err.stack lost the revision context:\n${err.stack}`);
    });

    it('does not duplicate the context in the stack', async function () {
      const pad = await padWithMissingRevision(3);
      const err: any = await pad.check().then(() => null, (e: any) => e);
      const occurrences = err.stack.split(`(pad ${padId} revision 3)`).length - 1;
      assert.equal(occurrences, 1, `context appears ${occurrences}x in the stack`);
    });

    it('keeps the original assertion text and stack frames', async function () {
      const pad = await padWithMissingRevision(3);
      const err: any = await pad.check().then(() => null, (e: any) => e);
      assert.match(err.stack, /assert\(timestamp != null\)/);
      assert.match(err.stack, /at Pad\.check/);
    });

    it('surfaces the revision through deleteRevisions()', async function () {
      // deleteRevisions() calls pad.check() before touching anything, so
      // this is the exact path from the issue report.
      await padWithMissingRevision(3);
      padManager.unloadPad(padId);
      const err: any = await deleteRevisions(padId, 2).then(() => null, (e: any) => e);
      assert.ok(err != null, 'expected deleteRevisions to throw');
      assert.match(err.stack, new RegExp(`\\(pad ${padId} revision 3\\)`),
          `err.stack lost the revision context:\n${err.stack}`);
    });
  });

  it('adds context for a bad chat message as well', async function () {
    const pad = await padManager.getPad(padId);
    await pad.appendText('hello\n');
    const author = await common.randomString();
    await pad.appendChatMessage({text: 'hi', authorId: author, time: Date.now()});
    await db.remove(`pad:${padId}:chat:0`, null);
    padManager.unloadPad(padId);

    const reloaded = await padManager.getPad(padId);
    const err: any = await reloaded.check().then(() => null, (e: any) => e);
    assert.ok(err != null, 'expected check() to throw');
    assert.match(err.stack, new RegExp(`\\(pad ${padId} chat message 0\\)`),
        `err.stack lost the chat context:\n${err.stack}`);
  });
});
