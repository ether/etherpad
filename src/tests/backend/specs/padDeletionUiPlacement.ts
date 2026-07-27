'use strict';

import {MapArrayType} from '../../../node/types/MapType';
import settings from '../../../node/utils/Settings';

const assert = require('assert').strict;
const common = require('../common');

// Regression coverage for issue #7959. The token-less "Delete pad" button
// (#delete-pad) used to be nested inside the `enablePadWideSettings`-gated
// pad-settings section, so disabling pad-wide settings removed the only way to
// delete a pad without a recovery token. Pad deletion is unrelated to pad-wide
// settings, so the button must be rendered regardless of that flag (its
// visibility is then driven at runtime by clientVars.canDeletePad).
describe(__filename, function () {
  this.timeout(30000);
  let agent: any;
  const backup: MapArrayType<any> = {};

  before(async function () { agent = await common.init(); });

  beforeEach(async function () {
    backup.enablePadWideSettings = settings.enablePadWideSettings;
  });

  afterEach(async function () {
    settings.enablePadWideSettings = backup.enablePadWideSettings;
  });

  const hasDeletePadButton = (html: string): boolean =>
    /id="delete-pad"/.test(html);

  it('renders the Delete pad button with pad-wide settings enabled', async function () {
    settings.enablePadWideSettings = true;
    const res = await agent.get('/p/deleteUiPlacementOn').expect(200);
    assert.equal(hasDeletePadButton(res.text), true);
  });

  it('renders the Delete pad button with pad-wide settings disabled (#7959)', async function () {
    settings.enablePadWideSettings = false;
    const res = await agent.get('/p/deleteUiPlacementOff').expect(200);
    assert.equal(hasDeletePadButton(res.text), true);
  });
});
