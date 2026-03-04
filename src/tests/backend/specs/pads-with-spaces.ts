'use strict';

const common = require('../common');

let agent:any;

describe(__filename, function () {
  before(async function () {
    agent = await common.init();
  });

  it('supports pads with spaces, regression test for #4883', async function () {
    await agent.get('/p/pads with spaces')
        .expect(302)
        .expect('location', 'pads_with_spaces');
  });

  it('supports pads with spaces and query, regression test for #4883', async function () {
    await agent.get('/p/pads with spaces?showChat=true&noColors=false')
        .expect(302)
        .expect('location', 'pads_with_spaces?showChat=true&noColors=false');
  });
});
