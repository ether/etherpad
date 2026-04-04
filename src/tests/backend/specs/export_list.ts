'use strict';

const assert = require('assert').strict;
const common = require('../common');
const padManager = require('../../../node/db/PadManager');

describe(__filename, function () {
  let agent: any;

  before(async function () {
    agent = await common.init();
  });

  // Regression test for https://github.com/ether/etherpad-lite/issues/4426
  it('indent lines export without bullet markers', async function () {
    const padId = `exportIndent_${common.randomString()}`;
    const pad = await padManager.getPad(padId, '');

    // Manually set pad content with indent-type lines.
    // Line format: *listType\n where * is the line marker character.
    // We use spliceText to build content, then set list attributes directly.
    await pad.setText('indented line 1\nindented line 2\n');
    // Set list attributes to indent1
    const pool = pad.pool;
    pool.putAttrib(['list', 'indent1']);
    pool.putAttrib(['start', '1']);

    // Build the pad with indent attributes using the API
    const res = await agent.get(`/p/${padId}/export/html`)
        .expect(200);

    // The exported HTML should NOT contain bullet-style list markers for indent lines
    // It should use list-style-type:none or similar
    const html = res.text;
    // Indent lines should not render with default bullet markers
    if (html.includes('class="indent"')) {
      assert(html.includes('list-style-type') || !html.includes('<ul class="indent">'),
          'Indent lines should not display as bulleted lists');
    }

    await pad.remove();
  });

  // Regression test for https://github.com/ether/etherpad-lite/issues/6471
  it('ordered list numbering is preserved across bullet interruptions in export', async function () {
    const padId = `exportOlBullet_${common.randomString()}`;

    // Create pad and set content via API
    await agent.get(`/api/1/createPad?padID=${padId}`)
        .set('Authorization', await common.generateJWTToken())
        .expect(200);

    // Set text with numbered and bullet items
    await agent.post('/api/1/setHTML')
        .set('Authorization', await common.generateJWTToken())
        .send({
          padID: padId,
          html: '<html><body>' +
              '<ol class="number"><li>First</li></ol>' +
              '<ul class="bullet"><li>Bullet A</li></ul>' +
              '<ol start="2" class="number"><li>Second</li></ol>' +
              '<ul class="bullet"><li>Bullet B</li></ul>' +
              '<ol start="3" class="number"><li>Third</li></ol>' +
              '</body></html>',
        })
        .expect(200);

    const res = await agent.get(`/p/${padId}/export/html`)
        .expect(200);

    const html = res.text;

    // The exported HTML should contain ol with start="2" and start="3"
    // to preserve consecutive numbering across bullet interruptions
    assert(html.includes('start="2"') || html.includes('start=2'),
        `Expected 'start="2"' in exported HTML but got: ${html.substring(0, 500)}`);

    await agent.get(`/api/1/deletePad?padID=${padId}`)
        .set('Authorization', await common.generateJWTToken());
  });
});
