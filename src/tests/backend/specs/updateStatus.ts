'use strict';

const assert = require('assert').strict;
const common = require('../common');
const plugins = require('../../../static/js/pluginfw/plugin_defs');
import settings from '../../../node/utils/Settings';
import {saveState} from '../../../node/updater/state';
import {EMPTY_STATE} from '../../../node/updater/types';
import path from 'node:path';

const statePath = () => path.join(settings.root, 'var', 'update-state.json');

// Hook names that plugins can register to influence auth decisions.
const authHookNames = ['preAuthorize', 'authenticate', 'authorize'];
const failHookNames = ['preAuthzFailure', 'authnFailure', 'authzFailure', 'authFailure'];

describe(__filename, function () {
  let agent: any;
  const backups: Record<string, any> = {};

  before(async function () {
    agent = await common.init();
  });

  beforeEach(async function () {
    // Reset the route module's badge cache so each test sees fresh state.
    const mod = require('../../../node/hooks/express/updateStatus');
    if (typeof mod._resetBadgeCacheForTests === 'function') {
      mod._resetBadgeCacheForTests();
    }
    // Save auth settings and hooks so we can restore after each test.
    backups.hooks = {};
    for (const hookName of authHookNames.concat(failHookNames)) {
      backups.hooks[hookName] = plugins.hooks[hookName];
    }
    backups.settings = {};
    for (const key of ['requireAuthentication', 'requireAuthorization', 'users']) {
      backups.settings[key] = (settings as any)[key];
    }
  });

  afterEach(async function () {
    Object.assign(plugins.hooks, backups.hooks);
    Object.assign(settings, backups.settings);
  });

  describe('GET /api/version-status', function () {
    it('returns null when no state', async function () {
      await saveState(statePath(), {...EMPTY_STATE});
      const res = await agent.get('/api/version-status').expect(200);
      assert.deepEqual(res.body, {outdated: null});
    });

    it('does not leak the running version', async function () {
      const res = await agent.get('/api/version-status').expect(200);
      assert.ok(!('version' in res.body), 'response leaks version field');
      assert.ok(!('latest' in res.body), 'response leaks latest field');
      assert.ok(!('currentVersion' in res.body), 'response leaks currentVersion field');
    });

    it('returns severe when running > 1 major behind', async function () {
      // Force "latest" to be 99.0.0 so our running version is severely outdated.
      await saveState(statePath(), {
        ...EMPTY_STATE,
        latest: {
          version: '99.0.0', tag: 'v99.0.0', body: '',
          publishedAt: '2099-01-01T00:00:00Z', prerelease: false,
          htmlUrl: 'https://example/',
        },
      });
      const res = await agent.get('/api/version-status').expect(200);
      assert.equal(res.body.outdated, 'severe');
    });
  });

  describe('GET /admin/update/status', function () {
    it('requires admin auth (rejects no-auth)', async function () {
      // Clear plugin auth hooks so ep_readonly_guest (and others) can't auto-grant access.
      for (const hookName of authHookNames.concat(failHookNames)) {
        plugins.hooks[hookName] = [];
      }
      // Etherpad's webaccess gates requests when requireAuthentication is enabled.
      (settings as any).requireAuthentication = true;
      (settings as any).requireAuthorization = false;
      (settings as any).users = {admin: {password: 'admin-password', is_admin: true}};
      await agent.get('/admin/update/status').expect(401);
    });
  });
});
