'use strict';

// GHSA-6vx2-3gwr-958v: author IDs and colors are attacker-controllable via .etherpad import and
// must not break out of the <style> block / class attribute emitted for createDiffHTML.

const assert = require('assert').strict;
const authorManager = require('../../../node/db/AuthorManager');
const common = require('../common');
const exportHtml = require('../../../node/utils/ExportHtml');
const importEtherpad = require('../../../node/utils/ImportEtherpad');
const padManager = require('../../../node/db/PadManager');
import {randomString} from '../../../static/js/pad_utils';

describe(__filename, function () {
  const colorPayload = 'red}</style><script>alert(1)</script><style>{';
  let padId: string;
  let authorId: string;

  const makeExport = (colorId: unknown) => ({
    'pad:src': {
      atext: {text: 'foo\n', attribs: '*0+3|1+1'},
      pool: {numToAttrib: {0: ['author', authorId]}, nextNum: 1},
      head: 0,
      savedRevisions: [],
    },
    [`globalAuthor:${authorId}`]: {
      colorId,
      name: 'evil',
      timestamp: 1598747784631,
      padIDs: 'src',
    },
    'pad:src:revs:0': {
      changeset: 'Z:1>3*0+3$foo',
      meta: {
        author: authorId,
        timestamp: 1597632398288,
        pool: {numToAttrib: {0: ['author', authorId]}, nextNum: 1},
        atext: {text: 'foo\n', attribs: '*0+3|1+1'},
      },
    },
  });

  before(async function () {
    await common.init();
  });

  beforeEach(async function () {
    padId = randomString(10);
    authorId = `a.${randomString(16)}`;
  });

  afterEach(async function () {
    if (await padManager.doesPadExist(padId)) await (await padManager.getPad(padId)).remove();
  });

  it('import replaces a malformed colorId', async function () {
    await importEtherpad.setPadRaw(padId, JSON.stringify(makeExport(colorPayload)));
    const colorId = await authorManager.getAuthorColorId(authorId);
    assert.notEqual(colorId, colorPayload);
    assert.equal(typeof colorId, 'number');
  });

  it('import replaces an out-of-range palette index', async function () {
    await importEtherpad.setPadRaw(padId, JSON.stringify(makeExport(999)));
    const colorId = await authorManager.getAuthorColorId(authorId);
    assert(colorId >= 0 && colorId < authorManager.getColorPalette().length, `${colorId}`);
  });

  it('import keeps an in-range palette index', async function () {
    await importEtherpad.setPadRaw(padId, JSON.stringify(makeExport(3)));
    assert.equal(await authorManager.getAuthorColorId(authorId), 3);
  });

  it('import keeps valid colorIds', async function () {
    await importEtherpad.setPadRaw(padId, JSON.stringify(makeExport('#abc123')));
    assert.equal(await authorManager.getAuthorColorId(authorId), '#abc123');
  });

  it('export drops a malformed color already in the database', async function () {
    await importEtherpad.setPadRaw(padId, JSON.stringify(makeExport(3)));
    // Simulate a record that predates import validation.
    await authorManager.setAuthorColorId(authorId, colorPayload);
    const pad = await padManager.getPad(padId);
    const html = await exportHtml.getHTMLFromAtext(pad, pad.atext, await pad.getAllAuthorColors());
    assert(!html.includes('<script>'), html);
    assert(!html.includes(colorPayload), html);
  });

  it('export emits valid colors unchanged', async function () {
    await importEtherpad.setPadRaw(padId, JSON.stringify(makeExport('#abc123')));
    const pad = await padManager.getPad(padId);
    const html = await exportHtml.getHTMLFromAtext(pad, pad.atext, await pad.getAllAuthorColors());
    const cls = `author${authorId.replace('.', '_')}`;
    assert(html.includes(`.${cls} {background-color: #abc123}`), html);
    assert(html.includes(`<span class="${cls}">foo</span>`), html);
  });

  it('export neutralizes a malicious author ID in the selector and class attribute', async function () {
    await importEtherpad.setPadRaw(padId, JSON.stringify(makeExport('#abc123')));
    const pad = await padManager.getPad(padId);
    const evilId = 'a.x"><img src=x onerror=alert(1)>{}</style><script>alert(2)</script>';
    const n = pad.apool().putAttrib(['author', evilId]);
    const atext = {text: 'foo\n', attribs: `*${n.toString(36)}+3|1+1`};
    const html = await exportHtml.getHTMLFromAtext(pad, atext, {[evilId]: '#abc123'});
    assert(!html.includes('<script>'), html);
    assert(!html.includes('<img'), html);
    assert(html.includes('<span class="authora_x___img_src_x_onerror_alert_1'), html);
  });
});
