'use strict';

const assert = require('assert').strict;
const common = require('../common');

describe(__filename, function () {
  let agent: any;

  before(async function () {
    agent = await common.init();
  });

  // Regression test for https://github.com/ether/etherpad-lite/issues/4426
  it('indent lines export with list-style-type:none', async function () {
    const padId = `exportIndent_${common.randomString()}`;

    // Create pad with indented content via setHTML
    await agent.get(`/api/1/createPad?padID=${padId}`)
        .set('Authorization', await common.generateJWTToken())
        .expect(200);

    // Import HTML with indent-type list items
    const importRes = await agent.post('/api/1/setHTML')
        .set('Authorization', await common.generateJWTToken())
        .send({
          padID: padId,
          html: '<html><body>' +
              '<ul class="indent"><li>indented line 1</li><li>indented line 2</li></ul>' +
              '</body></html>',
        })
        .expect(200);
    assert.equal(importRes.body.code, 0);

    const res = await agent.get(`/p/${padId}/export/html`)
        .expect(200);

    const html = res.text;

    // The exported HTML must contain indent class
    assert(html.includes('class="indent"'),
        `Expected 'class="indent"' in exported HTML but got: ${html.substring(0, 500)}`);
    // The indent ul must have list-style-type:none so it doesn't show bullets
    assert(html.includes('list-style-type'),
        `Expected 'list-style-type' style on indent ul but got: ${html.substring(0, 500)}`);

    await agent.get(`/api/1/deletePad?padID=${padId}`)
        .set('Authorization', await common.generateJWTToken());
  });

  // Regression test for https://github.com/ether/etherpad-lite/issues/6471
  it('ordered list numbering is preserved across bullet interruptions in export', async function () {
    const padId = `exportOlBullet_${common.randomString()}`;

    await agent.get(`/api/1/createPad?padID=${padId}`)
        .set('Authorization', await common.generateJWTToken())
        .expect(200);

    // Set text with numbered and bullet items
    const importRes = await agent.post('/api/1/setHTML')
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
    assert.equal(importRes.body.code, 0);

    const res = await agent.get(`/p/${padId}/export/html`)
        .expect(200);

    const html = res.text;

    // The exported HTML should contain ol with start="2" and start="3"
    assert(html.includes('start="2"') || html.includes('start=2'),
        `Expected 'start="2"' in exported HTML but got: ${html.substring(0, 500)}`);

    await agent.get(`/api/1/deletePad?padID=${padId}`)
        .set('Authorization', await common.generateJWTToken());
  });
});
