'use strict';

import {MapArrayType} from '../../../node/types/MapType.js';
import settings from '../../../node/utils/Settings.js';

const assert = require('assert').strict;
const common = require('../common');

// Regression coverage for the settings modal title. With
// `enablePadWideSettings: false` the template used to render
// `data-l10n-id="pad.settings.padSettings"` ("Pad-wide Settings") for every
// user, even though no pad-wide controls were rendered in that mode. The fix
// removes the conditional and always uses `pad.settings.title` ("Settings").
describe(__filename, function (this: any) {
  this.timeout(30000);
  let agent: any;
  const backup: MapArrayType<any> = {};

  before(async function (this: any) { agent = await common.init(); });

  beforeEach(async function (this: any) {
    backup.enablePadWideSettings = settings.enablePadWideSettings;
  });

  afterEach(async function (this: any) {
    settings.enablePadWideSettings = backup.enablePadWideSettings;
  });

  const titleH1 = (html: string): string | null => {
    const m = html.match(/<h1\s+id="settings-title"[^>]*data-l10n-id="([^"]+)"/);
    return m ? m[1] : null;
  };

  it('uses pad.settings.title with the feature enabled', async function (this: any) {
    settings.enablePadWideSettings = true;
    const res = await agent.get('/p/headingTest').expect(200);
    assert.equal(titleH1(res.text), 'pad.settings.title');
  });

  it('uses pad.settings.title with the feature disabled (no misleading "Pad-wide" label)', async function (this: any) {
    settings.enablePadWideSettings = false;
    const res = await agent.get('/p/headingTest').expect(200);
    assert.equal(titleH1(res.text), 'pad.settings.title');
  });
});
