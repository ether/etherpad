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
});
