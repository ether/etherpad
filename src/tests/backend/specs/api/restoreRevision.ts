'use strict';

import {PadType} from "../../../../node/types/PadType";

const assert = require('assert').strict;
const authorManager = require('../../../../node/db/AuthorManager');
const common = require('../../common');
const padManager = require('../../../../node/db/PadManager');

describe(__filename, function () {
  let agent:any;
  let authorId: string;
  let padId: string;
  let pad: PadType;

  const restoreRevision = async (v:string, padId: string, rev: number, authorId:string|null = null) => {
    // @ts-ignore
    const p = new URLSearchParams(Object.entries({
      padID: padId,
      rev,
      ...(authorId == null ? {} : {authorId}),
    }));
    const res = await agent.get(`/api/${v}/restoreRevision?${p}`)
        .set("Authorization", (await common.generateJWTToken()))
        .expect(200)
        .expect('Content-Type', /json/);
    assert.equal(res.body.code, 0);
  };

  before(async function () {
    agent = await common.init();
    authorId = await authorManager.getAuthor4Token('test-restoreRevision');
    assert(authorId);
  });

  beforeEach(async function () {
    padId = common.randomString();
    if (await padManager.doesPadExist(padId)) await padManager.removePad(padId);
    pad = await padManager.getPad(padId);
    await pad.appendText('\nfoo');
    await pad.appendText('\nbar');
    assert.equal(pad.head, 2);
  });

  afterEach(async function () {
    if (await padManager.doesPadExist(padId)) await padManager.removePad(padId);
  });

  describe('v1.2.11', function () {
    // TODO: Enable once the end-of-pad newline bugs are fixed. See:
    // https://github.com/ether/etherpad-lite/pull/5253
    xit('content matches', async function () {
      const oldHead = pad.head;
      const wantAText = await pad.getInternalRevisionAText(pad.head - 1);
      assert(wantAText.text.endsWith('\nfoo\n'));
      await restoreRevision('1.2.11', padId, pad.head - 1);
      assert.equal(pad.head, oldHead + 1);
      assert.deepEqual(await pad.getInternalRevisionAText(pad.head), wantAText);
    });

    it('authorId ignored', async function () {
      const oldHead = pad.head;
      await restoreRevision('1.2.11', padId, pad.head - 1, authorId);
      assert.equal(pad.head, oldHead + 1);
      assert.equal(await pad.getRevisionAuthor(pad.head), '');
    });
  });

  describe('v1.3.0', function () {
    it('change is attributed to given authorId', async function () {
      const oldHead = pad.head;
      await restoreRevision('1.3.0', padId, pad.head - 1, authorId);
      assert.equal(pad.head, oldHead + 1);
      assert.equal(await pad.getRevisionAuthor(pad.head), authorId);
    });

    it('authorId can be omitted', async function () {
      const oldHead = pad.head;
      await restoreRevision('1.3.0', padId, pad.head - 1);
      assert.equal(pad.head, oldHead + 1);
      assert.equal(await pad.getRevisionAuthor(pad.head), '');
    });
  });
});
