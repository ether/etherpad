'use strict';

import {MapArrayType} from "../../../node/types/MapType";

const assert = require('assert').strict;
const authorManager = require('../../../node/db/AuthorManager');
const db = require('../../../node/db/DB');
const importEtherpad = require('../../../node/utils/ImportEtherpad');
const padManager = require('../../../node/db/PadManager');
const plugins = require('../../../static/js/pluginfw/plugin_defs');
import {randomString} from '../../../static/js/pad_utils';

describe(__filename, function () {
  let padId: string;

  const makeAuthorId = () => `a.${randomString(16)}`;

  const makeExport = (authorId: string) => ({
    'pad:testing': {
      atext: {
        text: 'foo\n',
        attribs: '|1+4',
      },
      pool: {
        numToAttrib: {},
        nextNum: 0,
      },
      head: 0,
      savedRevisions: [],
    },
    [`globalAuthor:${authorId}`]: {
      colorId: '#000000',
      name: 'new',
      timestamp: 1598747784631,
      padIDs: 'testing',
    },
    'pad:testing:revs:0': {
      changeset: 'Z:1>3+3$foo',
      meta: {
        author: '',
        timestamp: 1597632398288,
        pool: {
          numToAttrib: {},
          nextNum: 0,
        },
        atext: {
          text: 'foo\n',
          attribs: '|1+4',
        },
      },
    },
  });

  beforeEach(async function () {
    padId = randomString(10);
    assert(!await padManager.doesPadExist(padId));
  });

  it('unknown db records are ignored', async function () {
    const badKey = `maliciousDbKey${randomString(10)}`;
    await importEtherpad.setPadRaw(padId, JSON.stringify({
      [badKey]: 'value',
      ...makeExport(makeAuthorId()),
    }));
    assert(await db.get(badKey) == null);
  });

  it('changes are all or nothing', async function () {
    const authorId = makeAuthorId();
    const data:MapArrayType<any> = makeExport(authorId);
    data['pad:differentPadId:revs:0'] = data['pad:testing:revs:0'];
    delete data['pad:testing:revs:0'];
    assert.rejects(importEtherpad.setPadRaw(padId, JSON.stringify(data)), /unexpected pad ID/);
    assert(!await authorManager.doesAuthorExist(authorId));
    assert(!await padManager.doesPadExist(padId));
  });

  describe('author pad IDs', function () {
    let existingAuthorId: string;
    let newAuthorId:string;

    beforeEach(async function () {
      existingAuthorId = (await authorManager.createAuthor('existing')).authorID;
      assert(await authorManager.doesAuthorExist(existingAuthorId));
      assert.deepEqual((await authorManager.listPadsOfAuthor(existingAuthorId)).padIDs, []);
      newAuthorId = makeAuthorId();
      assert.notEqual(newAuthorId, existingAuthorId);
      assert(!await authorManager.doesAuthorExist(newAuthorId));
    });

    it('author does not yet exist', async function () {
      await importEtherpad.setPadRaw(padId, JSON.stringify(makeExport(newAuthorId)));
      assert(await authorManager.doesAuthorExist(newAuthorId));
      const author = await authorManager.getAuthor(newAuthorId);
      assert.equal(author.name, 'new');
      assert.equal(author.colorId, '#000000');
      assert.deepEqual((await authorManager.listPadsOfAuthor(newAuthorId)).padIDs, [padId]);
    });

    it('author already exists, no pads', async function () {
      newAuthorId = existingAuthorId;
      await importEtherpad.setPadRaw(padId, JSON.stringify(makeExport(newAuthorId)));
      assert(await authorManager.doesAuthorExist(newAuthorId));
      const author = await authorManager.getAuthor(newAuthorId);
      assert.equal(author.name, 'existing');
      assert.notEqual(author.colorId, '#000000');
      assert.deepEqual((await authorManager.listPadsOfAuthor(newAuthorId)).padIDs, [padId]);
    });

    it('author already exists, on different pad', async function () {
      const otherPadId = randomString(10);
      await authorManager.addPad(existingAuthorId, otherPadId);
      newAuthorId = existingAuthorId;
      await importEtherpad.setPadRaw(padId, JSON.stringify(makeExport(newAuthorId)));
      assert(await authorManager.doesAuthorExist(newAuthorId));
      const author = await authorManager.getAuthor(newAuthorId);
      assert.equal(author.name, 'existing');
      assert.notEqual(author.colorId, '#000000');
      assert.deepEqual(
          (await authorManager.listPadsOfAuthor(newAuthorId)).padIDs.sort(),
          [otherPadId, padId].sort());
    });

    it('author already exists, on same pad', async function () {
      await authorManager.addPad(existingAuthorId, padId);
      newAuthorId = existingAuthorId;
      await importEtherpad.setPadRaw(padId, JSON.stringify(makeExport(newAuthorId)));
      assert(await authorManager.doesAuthorExist(newAuthorId));
      const author = await authorManager.getAuthor(newAuthorId);
      assert.equal(author.name, 'existing');
      assert.notEqual(author.colorId, '#000000');
      assert.deepEqual((await authorManager.listPadsOfAuthor(newAuthorId)).padIDs, [padId]);
    });
  });

  describe('enforces consistent pad ID', function () {
    it('pad record has different pad ID', async function () {
      const data:MapArrayType<any> = makeExport(makeAuthorId());
      data['pad:differentPadId'] = data['pad:testing'];
      delete data['pad:testing'];
      assert.rejects(importEtherpad.setPadRaw(padId, JSON.stringify(data)), /unexpected pad ID/);
    });

    it('globalAuthor record has different pad ID', async function () {
      const authorId = makeAuthorId();
      const data = makeExport(authorId);
      data[`globalAuthor:${authorId}`].padIDs = 'differentPadId';
      assert.rejects(importEtherpad.setPadRaw(padId, JSON.stringify(data)), /unexpected pad ID/);
    });

    it('pad rev record has different pad ID', async function () {
      const data:MapArrayType<any> = makeExport(makeAuthorId());
      data['pad:differentPadId:revs:0'] = data['pad:testing:revs:0'];
      delete data['pad:testing:revs:0'];
      assert.rejects(importEtherpad.setPadRaw(padId, JSON.stringify(data)), /unexpected pad ID/);
    });
  });

  describe('order of records does not matter', function () {
    for (const perm of [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]]) {
      it(JSON.stringify(perm), async function () {
        const authorId = makeAuthorId();
        const records = Object.entries(makeExport(authorId));
        assert.equal(records.length, 3);
        await importEtherpad.setPadRaw(
            padId, JSON.stringify(Object.fromEntries(perm.map((i) => records[i]))));
        assert.deepEqual((await authorManager.listPadsOfAuthor(authorId)).padIDs, [padId]);
        const pad = await padManager.getPad(padId);
        assert.equal(pad.text(), 'foo\n');
      });
    }
  });

  // Regression test for https://github.com/ether/etherpad-lite/issues/6785
  describe('old .etherpad imports without author metadata', function () {
    // Old exports (circa 2014) have revisions where meta.author is missing entirely
    const makeOldExportNoAuthor = () => ({
      'pad:testing': {
        atext: {
          text: 'foo\n',
          attribs: '|1+4',
        },
        pool: {
          numToAttrib: {},
          nextNum: 0,
        },
        head: 0,
        savedRevisions: [],
      },
      // Revision 0 has no meta.author — this is how very old etherpads exported
      'pad:testing:revs:0': {
        changeset: 'Z:1>3+3$foo',
        meta: {
          timestamp: 1273769875976,
          atext: {
            text: 'foo\n',
            attribs: '|1+4',
          },
        },
      },
    });

    it('imports without error when revision lacks meta.author', async function () {
      await importEtherpad.setPadRaw(padId, JSON.stringify(makeOldExportNoAuthor()));
      const pad = await padManager.getPad(padId);
      assert.equal(pad.text(), 'foo\n');
      assert.equal(pad.head, 0);
    });

    it('getRevisionAuthor returns empty string for missing author', async function () {
      await importEtherpad.setPadRaw(padId, JSON.stringify(makeOldExportNoAuthor()));
      const pad = await padManager.getPad(padId);
      assert.equal(await pad.getRevisionAuthor(0), '');
    });
  });

  describe('security metadata is not taken from the file', function () {
    const crypto = require('crypto');
    const padDeletionManager = require('../../../node/db/PadDeletionManager');
    const sha256 = (s: string) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
    let creatorId: string;
    let importerId: string;

    // An export whose only revision was written by `rev0Author`.
    const makeAuthoredExport = (rev0Author: string): MapArrayType<any> => {
      const pool = {numToAttrib: {0: ['author', rev0Author]}, nextNum: 1};
      const atext = {text: 'foo\n', attribs: '*0+3|1+1'};
      return {
        'pad:testing': {atext, pool, head: 0, chatHead: -1, savedRevisions: []},
        [`globalAuthor:${rev0Author}`]: {
          colorId: '#000000', name: 'new', timestamp: 1598747784631, padIDs: 'testing',
        },
        'pad:testing:revs:0': {
          changeset: 'Z:1>3*0+3$foo',
          meta: {author: rev0Author, timestamp: 1597632398288, pool, atext},
        },
      };
    };

    const importAndReload = async (records: MapArrayType<any>, authorId: string) => {
      await importEtherpad.setPadRaw(padId, JSON.stringify(records), authorId);
      padManager.unloadPad(padId);
      return await padManager.getPad(padId);
    };

    beforeEach(async function () {
      creatorId = makeAuthorId();
      importerId = makeAuthorId();
      await padManager.getPad(padId, '\n', creatorId);
    });

    it('ignores a deletionToken record and keeps the existing token', async function () {
      const token = await padDeletionManager.createDeletionTokenIfAbsent(padId);
      await importAndReload({
        ...makeAuthoredExport(creatorId),
        'pad:testing:deletionToken': {createdAt: 0, hash: sha256('attackertoken')},
      }, importerId);
      assert(!await padDeletionManager.isValidDeletionToken(padId, 'attackertoken'));
      assert(await padDeletionManager.isValidDeletionToken(padId, token));
    });

    it('ignores pad sub-keys other than revs and chat', async function () {
      const exp = makeAuthoredExport(creatorId);
      await importAndReload({
        ...exp,
        'pad:testing': {...exp['pad:testing'], chatHead: 0},
        'pad:testing:foo': {x: 1},
        'pad:testing:revs:foo': {x: 1},
        'pad:testing:chat:0': {text: 'hi', authorId: creatorId, time: 1},
      }, importerId);
      assert(await db.get(`pad:${padId}:foo`) == null);
      assert(await db.get(`pad:${padId}:revs:foo`) == null);
      assert.equal((await db.get(`pad:${padId}:chat:0`)).text, 'hi');
    });

    it('does not let the file make a pad public', async function () {
      const exp = makeAuthoredExport(creatorId);
      const pad = await importAndReload(
          {...exp, 'pad:testing': {...exp['pad:testing'], publicStatus: true}}, importerId);
      assert.equal(pad.getPublicStatus(), false);
    });

    it('keeps the target pad public status', async function () {
      const target = await padManager.getPad(padId);
      await target.setPublicStatus(true);
      const pad = await importAndReload(makeAuthoredExport(creatorId), importerId);
      assert.equal(pad.getPublicStatus(), true);
    });

    it('keeps the creator when a non-creator imports a file naming someone else', async function () {
      // The GHSA-qq7c forgery: a writer imports a file that names them as the creator.
      const pad = await importAndReload(makeAuthoredExport(importerId), importerId);
      assert.equal(await pad.getRevisionAuthor(0), creatorId);
      assert.equal(pad.text(), 'foo\n');
      await pad.check();
    });

    it('lets the creator import a file that names a different creator', async function () {
      const pad = await importAndReload(makeAuthoredExport(importerId), creatorId);
      assert.equal(await pad.getRevisionAuthor(0), importerId);
    });

    it('imports a same-creator file unchanged', async function () {
      const exp = makeAuthoredExport(creatorId);
      const pad = await importAndReload(exp, importerId);
      assert.equal(await pad.getRevisionAuthor(0), creatorId);
      assert.deepEqual(pad.pool.toJsonable(), exp['pad:testing'].pool);
      assert.deepEqual(pad.atext, exp['pad:testing'].atext);
    });

    it('does not let a non-creator take pad settings from a file naming them', async function () {
      const exp = makeAuthoredExport(importerId);
      const pad = await importAndReload({
        ...exp,
        'pad:testing': {...exp['pad:testing'], padSettings: {enforceSettings: true}},
      }, importerId);
      assert.equal(await pad.getRevisionAuthor(0), creatorId);
      assert.equal(pad.getPadSettings().enforceSettings, false);
    });

    it('keeps the target pad settings when the importer is not the creator', async function () {
      const exp = makeAuthoredExport(creatorId);
      const pad = await importAndReload({
        ...exp,
        'pad:testing': {...exp['pad:testing'], padSettings: {enforceSettings: true}},
      }, importerId);
      assert.equal(pad.getPadSettings().enforceSettings, false);
    });

    it('takes pad settings from the file when the importer is the creator', async function () {
      const exp = makeAuthoredExport(creatorId);
      const pad = await importAndReload({
        ...exp,
        'pad:testing': {...exp['pad:testing'], padSettings: {enforceSettings: true}},
      }, creatorId);
      assert.equal(pad.getPadSettings().enforceSettings, true);
    });
  });

  describe('pads created through the HTTP API', function () {
    const api = require('../../../node/db/API');
    const {SYSTEM_AUTHOR_ID} = require('../../../node/utils/SystemAuthor');

    // An export of a browser-created pad: rev 0 was written by a real author.
    const makeBrowserExport = (rev0Author: string): MapArrayType<any> => {
      const pool = {numToAttrib: {0: ['author', rev0Author]}, nextNum: 1};
      const atext = {text: 'hello\n', attribs: '*0+5|1+1'};
      return {
        'pad:testing': {
          atext, pool, head: 0, chatHead: -1, savedRevisions: [],
          padSettings: {enforceSettings: true},
        },
        [`globalAuthor:${rev0Author}`]: {
          colorId: '#000000', name: 'new', timestamp: 1598747784631, padIDs: 'testing',
        },
        'pad:testing:revs:0': {
          changeset: 'Z:1>5*0+5$hello',
          meta: {author: rev0Author, timestamp: 1597632398288, pool, atext},
        },
      };
    };

    const importAndReload = async (records: MapArrayType<any>, authorId: string) => {
      await importEtherpad.setPadRaw(padId, JSON.stringify(records), authorId);
      padManager.unloadPad(padId);
      return await padManager.getPad(padId);
    };

    for (const [desc, text] of [['with text', 'api text\n'], ['without text', '']]) {
      it(`imports a browser pad export into a createPad pad ${desc}`, async function () {
        await api.createPad(padId, text);
        const apiCreator = await (await padManager.getPad(padId)).getRevisionAuthor(0);
        assert.equal(apiCreator, text ? SYSTEM_AUTHOR_ID : '');
        const fileAuthor = makeAuthorId();
        const importer = makeAuthorId();
        const pad = await importAndReload(makeBrowserExport(fileAuthor), importer);
        assert.equal(pad.text(), 'hello\n');
        assert.equal(await pad.getRevisionAuthor(0), apiCreator);
        // The text keeps its original authorship.
        assert(pad.getAllAuthors().includes(fileAuthor));
        assert.equal(pad.getPadSettings().enforceSettings, false);
        await pad.check();
      });
    }

    it('keeps the system creator when the file author imports their own export', async function () {
      await api.createPad(padId, 'api text\n');
      const fileAuthor = makeAuthorId();
      const pad = await importAndReload(makeBrowserExport(fileAuthor), fileAuthor);
      assert.equal(await pad.getRevisionAuthor(0), SYSTEM_AUTHOR_ID);
      assert.equal(pad.getPadSettings().enforceSettings, false);
    });

    it('does not let the importer become the creator of a group pad', async function () {
      const {groupID} = await api.createGroup();
      const {padID} = await api.createGroupPad(groupID, randomString(10), 'api text\n');
      padId = padID;
      const importer = makeAuthorId();
      const exp = makeBrowserExport(importer);
      const pad = await importAndReload(
          {...exp, 'pad:testing': {...exp['pad:testing'], publicStatus: true}}, importer);
      assert.equal(await pad.getRevisionAuthor(0), SYSTEM_AUTHOR_ID);
      assert.equal(pad.getPublicStatus(), false);
      await pad.check();
    });
  });

  describe('exportEtherpadAdditionalContent', function () {
    let hookBackup: Function;

    before(async function () {
      hookBackup = plugins.hooks.exportEtherpadAdditionalContent || [];
      plugins.hooks.exportEtherpadAdditionalContent = [{hook_fn: () => ['custom']}];
    });

    after(async function () {
      plugins.hooks.exportEtherpadAdditionalContent = hookBackup;
    });

    it('imports from custom prefix', async function () {
      await importEtherpad.setPadRaw(padId, JSON.stringify({
        ...makeExport(makeAuthorId()),
        'custom:testing': 'a',
        'custom:testing:foo': 'b',
      }));
      const pad = await padManager.getPad(padId);
      assert.equal(await pad.db.get(`custom:${padId}`), 'a');
      assert.equal(await pad.db.get(`custom:${padId}:foo`), 'b');
    });

    it('rejects records for pad with similar ID', async function () {
      await assert.rejects(importEtherpad.setPadRaw(padId, JSON.stringify({
        ...makeExport(makeAuthorId()),
        'custom:testingx': 'x',
      })), /unexpected pad ID/);
      assert(await db.get(`custom:${padId}x`) == null);
      await assert.rejects(importEtherpad.setPadRaw(padId, JSON.stringify({
        ...makeExport(makeAuthorId()),
        'custom:testingx:foo': 'x',
      })), /unexpected pad ID/);
      assert(await db.get(`custom:${padId}x:foo`) == null);
    });
  });
});
