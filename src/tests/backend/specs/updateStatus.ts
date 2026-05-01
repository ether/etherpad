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
    // Auth on this endpoint is intentionally loose: the running version is already
    // exposed publicly via /health (releaseId), and latest/changelog come from a
    // public GitHub release. Admins who want the endpoint gone set updates.tier=off,
    // which removes route registration entirely (covered by the unit test for the
    // hook). Here we just assert the basic shape.
    it('returns the expected shape', async function () {
      await saveState(statePath(), {...EMPTY_STATE});
      const res = await agent.get('/admin/update/status').expect(200);
      assert.ok(typeof res.body.currentVersion === 'string');
      assert.equal(res.body.latest, null);
      assert.equal(res.body.tier, settings.updates.tier);
      assert.ok(Array.isArray(res.body.vulnerableBelow));
    });

    describe('when updates.requireAdminForStatus = true', function () {
      const restore: Record<string, any> = {};
      beforeEach(function () {
        restore.requireAdminForStatus = settings.updates.requireAdminForStatus;
        settings.updates.requireAdminForStatus = true;
      });
      afterEach(function () {
        settings.updates.requireAdminForStatus = restore.requireAdminForStatus;
      });

      it('rejects unauthenticated requests with 401', async function () {
        await agent.get('/admin/update/status').expect(401);
      });

      it('rejects authenticated non-admin sessions with 403', async function () {
        // Inject a session via authenticate hook: any request becomes user "guest" (not admin).
        for (const hookName of authHookNames.concat(failHookNames)) {
          plugins.hooks[hookName] = [];
        }
        plugins.hooks.authenticate = [{
          hook_fn: (_hookName: string, ctx: any, cb: Function) => {
            ctx.req.session.user = {is_admin: false};
            cb([true]);
          },
        }];
        (settings as any).requireAuthentication = true;
        (settings as any).requireAuthorization = false;
        (settings as any).users = {guest: {password: 'guest-password'}};
        await agent.get('/admin/update/status')
          .auth('guest', 'guest-password')
          .expect(403);
      });

      it('admits authenticated admin sessions', async function () {
        for (const hookName of authHookNames.concat(failHookNames)) {
          plugins.hooks[hookName] = [];
        }
        plugins.hooks.authenticate = [{
          hook_fn: (_hookName: string, ctx: any, cb: Function) => {
            ctx.req.session.user = {is_admin: true};
            cb([true]);
          },
        }];
        (settings as any).requireAuthentication = true;
        (settings as any).requireAuthorization = false;
        (settings as any).users = {admin: {password: 'admin-password', is_admin: true}};
        await saveState(statePath(), {...EMPTY_STATE});
        await agent.get('/admin/update/status')
          .auth('admin', 'admin-password')
          .expect(200);
      });
    });
  });
});
