'use strict';

const assert = require('assert').strict;
const common = require('../common');
const padManager = require('../../../node/db/PadManager');
const importHtml = require('../../../node/utils/ImportHtml');
const exportHtml = require('../../../node/utils/ExportHtml');

describe(__filename, function () {
  before(async function () {
    await common.init();
  });

  // Regression test for https://github.com/ether/etherpad-lite/issues/4426
  it('indent lines export with list-style-type:none', async function () {
    const padId = `exportIndent_${common.randomString()}`;
    const pad = await padManager.getPad(padId, 'placeholder');

    // Import HTML with indent-type list items
    await importHtml.setPadHTML(pad,
        '<html><body>' +
        '<ul class="indent"><li>indented line 1</li><li>indented line 2</li></ul>' +
        '</body></html>');

    const html = await exportHtml.getPadHTML(pad, undefined);

    // Indent ul must have list-style-type:none so it doesn't show bullets
    assert(html.includes('class="indent"'),
        `Expected 'class="indent"' in: ${html}`);
    assert(html.includes('list-style-type'),
        `Expected 'list-style-type' on indent ul in: ${html}`);

    await pad.remove();
  });

  // Regression test for https://github.com/ether/etherpad-lite/issues/6471
  it('ordered list numbering preserved across bullet interruptions (round-trip)', async function () {
    const padId = `exportOlBullet_${common.randomString()}`;
    const pad = await padManager.getPad(padId, 'placeholder');

    await importHtml.setPadHTML(pad,
        '<html><body>' +
        '<ol class="number"><li>First</li></ol>' +
        '<ul class="bullet"><li>Bullet A</li></ul>' +
        '<ol start="2" class="number"><li>Second</li></ol>' +
        '</body></html>');

    const html = await exportHtml.getPadHTML(pad, undefined);

    // The second ol should have a start value of 2, showing the numbering continues
    // after the bullet interruption (not reset to 1)
    assert(html.includes('start="2"'),
        `Expected start="2" for continued numbering in: ${html}`);

    await pad.remove();
  });

  // Regression test for https://github.com/ether/etherpad-lite/issues/6471
  // Tests that the export counter-based fix works even when the pad content
  // does not carry explicit start attributes (e.g. content created without
  // import start values).
  it('ordered list numbering preserved across bullet interruptions (no explicit start)', async function () {
    const padId = `exportOlBulletNoStart_${common.randomString()}`;
    const pad = await padManager.getPad(padId, 'placeholder');

    // Import HTML without start attributes — the second <ol> has no start="2"
    await importHtml.setPadHTML(pad,
        '<html><body>' +
        '<ol class="number"><li>First</li></ol>' +
        '<ul class="bullet"><li>Bullet A</li></ul>' +
        '<ol class="number"><li>Second</li></ol>' +
        '</body></html>');

    const html = await exportHtml.getPadHTML(pad, undefined);

    // Even though the import had no start attribute, the export should add
    // start="2" to continue the numbering after the bullet interruption
    assert(html.includes('start="2"'),
        `Expected start="2" for continued numbering in: ${html}`);

    await pad.remove();
  });

  // Regression test for https://github.com/ether/etherpad-lite/issues/6471
  // Tests multiple ordered list items before and after bullet interruptions.
  it('ordered list numbering preserved with multiple items', async function () {
    const padId = `exportOlMulti_${common.randomString()}`;
    const pad = await padManager.getPad(padId, 'placeholder');

    await importHtml.setPadHTML(pad,
        '<html><body>' +
        '<ol class="number"><li>First</li><li>Second</li></ol>' +
        '<ul class="bullet"><li>Bullet</li></ul>' +
        '<ol class="number"><li>Third</li></ol>' +
        '</body></html>');

    const html = await exportHtml.getPadHTML(pad, undefined);

    // After two ordered items then a bullet, the next ol should start at 3
    assert(html.includes('start="3"'),
        `Expected start="3" for continued numbering in: ${html}`);

    await pad.remove();
  });

  // Regression test: counters for closed indent levels must be cleared
  // when list depth decreases so re-entering the same level under a
  // different parent starts fresh numbering.
  it('nested ordered list counters reset when closing levels', async function () {
    const padId = `exportOlNested_${common.randomString()}`;
    const pad = await padManager.getPad(padId, 'placeholder');

    // Structure:
    //   1. Parent A          (level 1)
    //     1. Child A1        (level 2)
    //     2. Child A2        (level 2)
    //   2. Parent B          (level 1)
    //     1. Child B1        (level 2)  <-- should restart at 1, not 3
    await importHtml.setPadHTML(pad,
        '<html><body>' +
        '<ol class="number"><li>Parent A' +
        '<ol class="number"><li>Child A1</li><li>Child A2</li></ol>' +
        '</li><li>Parent B' +
        '<ol class="number"><li>Child B1</li></ol>' +
        '</li></ol>' +
        '</body></html>');

    const html = await exportHtml.getPadHTML(pad, undefined);

    // The inner ol under Parent B should NOT have start="3".
    // It must either have no start attribute (defaulting to 1) or start="1".
    // Count how many inner <ol tags appear — the second nested ol must not
    // carry a stale counter from the first nested list.
    const innerOlMatches = html.match(/<ol[^>]*class="number"[^>]*>/g) || [];
    // There should be at least 3 ol tags (outer + 2 nested).
    assert(innerOlMatches.length >= 3,
        `Expected at least 3 ol tags, got ${innerOlMatches.length} in: ${html}`);
    // The last nested ol (for Child B1) should not have start="3"
    const lastInnerOl = innerOlMatches[innerOlMatches.length - 1];
    assert(!lastInnerOl.includes('start="3"'),
        `Nested ol under Parent B should not continue numbering from Parent A's children: ${html}`);

    await pad.remove();
  });
});
