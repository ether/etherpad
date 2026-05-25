import * as assert from 'node:assert/strict';
import * as common from '../common.js';
import plugins from '../../../static/js/pluginfw/plugin_defs.js';
import settings from '../../../node/utils/Settings.js';
import {saveState} from '../../../node/updater/state.js';
import {EMPTY_STATE} from '../../../node/updater/types.js';
import path from 'node:path';
import * as updateStatusMod from '../../../node/hooks/express/updateStatus.js';

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
    if (typeof (updateStatusMod as any)._resetBadgeCacheForTests === 'function') {
      (updateStatusMod as any)._resetBadgeCacheForTests();
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
    });

    it('redacts execution.reason / lastResult.reason for unauth callers', async function () {
      // Seed state with diagnostic strings that would leak environment details.
      await saveState(statePath(), {
        ...EMPTY_STATE,
        execution: {
          status: 'rollback-failed',
          reason: 'pnpm install exit 1: ENOSPC at /srv/etherpad/v2.7.3',
          targetTag: 'v2.7.3',
          fromSha: 'abc123def456',
          at: '2026-05-08T00:00:00Z',
        },
        lastResult: {
          targetTag: 'v2.7.3',
          fromSha: 'abc123def456',
          outcome: 'rollback-failed',
          reason: 'pnpm install failed: ENOSPC at /srv/etherpad/v2.7.3',
          at: '2026-05-08T00:00:00Z',
        },
      });
      const res = await agent.get('/admin/update/status').expect(200);
      // Status enum + outcome enum are kept (UI needs them).
      assert.equal(res.body.execution.status, 'rollback-failed');
      assert.equal(res.body.lastResult.outcome, 'rollback-failed');
      // Diagnostic fields are stripped for unauth callers.
      assert.equal(res.body.execution.reason, undefined);
      assert.equal(res.body.execution.fromSha, undefined);
      assert.equal(res.body.execution.targetTag, undefined);
      assert.equal(res.body.lastResult.reason, undefined);
      assert.equal(res.body.lastResult.fromSha, undefined);
      assert.equal(res.body.lastResult.targetTag, undefined);
      // Non-sensitive fields preserved on lastResult.
      assert.equal(res.body.lastResult.at, '2026-05-08T00:00:00Z');
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

    describe('admin auth (without requireAdminForStatus)', function () {
      // requireAdminForStatus=false (default) keeps the endpoint open for the
      // pad-side / banner usage, but admin callers should still see full
      // diagnostic detail (execution.reason, fromSha, etc.).
      it('returns full diagnostic payload to authed admin sessions', async function () {
        for (const hookName of authHookNames.concat(failHookNames)) plugins.hooks[hookName] = [];
        plugins.hooks.authenticate = [{
          hook_fn: (_hookName: string, ctx: any, cb: Function) => {
            ctx.req.session.user = {is_admin: true};
            cb([true]);
          },
        }];
        (settings as any).requireAuthentication = true;
        (settings as any).requireAuthorization = false;
        (settings as any).users = {admin: {password: 'admin-password', is_admin: true}};
        await saveState(statePath(), {
          ...EMPTY_STATE,
          execution: {
            status: 'rollback-failed',
            reason: 'pnpm install exit 1',
            targetTag: 'v2.7.3', fromSha: 'abc',
            at: '2026-05-08T00:00:00Z',
          },
          lastResult: {
            targetTag: 'v2.7.3', fromSha: 'abc',
            outcome: 'rollback-failed', reason: 'pnpm install failed',
            at: '2026-05-08T00:00:00Z',
          },
        });
        const res = await agent.get('/admin/update/status')
          .auth('admin', 'admin-password').expect(200);
        // Admin sees the full diagnostic detail (it's their own server).
        assert.equal(res.body.execution.reason, 'pnpm install exit 1');
        assert.equal(res.body.execution.fromSha, 'abc');
        assert.equal(res.body.lastResult.reason, 'pnpm install failed');
      });
    });
  });
});
