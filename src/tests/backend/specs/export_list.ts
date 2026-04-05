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
  it('ordered list numbering preserved across bullet interruptions', async function () {
    const padId = `exportOlBullet_${common.randomString()}`;
    const pad = await padManager.getPad(padId, 'placeholder');

    await importHtml.setPadHTML(pad,
        '<html><body>' +
        '<ol class="number"><li>First</li></ol>' +
        '<ul class="bullet"><li>Bullet A</li></ul>' +
        '<ol start="2" class="number"><li>Second</li></ol>' +
        '</body></html>');

    const html = await exportHtml.getPadHTML(pad, undefined);

    // The second ol should have a start value > 1, showing the numbering continues
    // after the bullet interruption (not reset to 1)
    const startMatches = html.match(/start="(\d+)"/g) || [];
    assert(startMatches.length >= 2,
        `Expected at least 2 ol start attributes in: ${html}`);
    // Verify at least one start value is > 1
    const hasHighStart = startMatches.some((m: string) => parseInt(m.match(/\d+/)![0]) > 1);
    assert(hasHighStart,
        `Expected a start value > 1 for continued numbering in: ${html}`);

    await pad.remove();
  });
});
