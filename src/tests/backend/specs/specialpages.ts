'use strict';

import {MapArrayType} from "../../../node/types/MapType";

const common = require('../common');
import settings from '../../../node/utils/Settings';



describe(__filename, function () {
  this.timeout(30000);
  let agent:any;
  const backups:MapArrayType<any> = {};
  before(async function () { agent = await common.init(); });
  beforeEach(async function () {
    backups.settings = {};
    for (const setting of ['requireAuthentication', 'requireAuthorization']) {
      // @ts-ignore
      backups.settings[setting] = settings[setting];
    }
    settings.requireAuthentication = false;
    settings.requireAuthorization = false;
  });
  afterEach(async function () {
    Object.assign(settings, backups.settings);
  });

  describe('/javascript', function () {
    it('/javascript -> 200', async function () {
      await agent.get('/javascript').expect(200);
    });
  });
});
