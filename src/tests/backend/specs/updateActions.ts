'use strict';

const assert = require('assert').strict;
const common = require('../common');
const plugins = require('../../../static/js/pluginfw/plugin_defs');
import settings from '../../../node/utils/Settings';
import {saveState} from '../../../node/updater/state';
import {EMPTY_STATE} from '../../../node/updater/types';
import path from 'node:path';

const statePath = () => path.join(settings.root, 'var', 'update-state.json');
const lockPath = () => path.join(settings.root, 'var', 'update.lock');

const authHookNames = ['preAuthorize', 'authenticate', 'authorize'];
const failHookNames = ['preAuthzFailure', 'authnFailure', 'authzFailure', 'authFailure'];

const installAdminAuth = () => {
  for (const h of authHookNames.concat(failHookNames)) plugins.hooks[h] = [];
  plugins.hooks.authenticate = [{
    hook_fn: (_n: string, ctx: any, cb: Function) => {
      ctx.req.session.user = {is_admin: true};
      cb([true]);
    },
  }];
  (settings as any).requireAuthentication = true;
  (settings as any).requireAuthorization = false;
  (settings as any).users = {admin: {password: 'admin-pw', is_admin: true}};
};

describe(__filename, function () {
  let agent: any;
  const backups: Record<string, any> = {};
  // Bump tier to 'manual' so the action endpoints are mounted by the hook.
  // (At default tier 'notify' they 404 — that's the gate Qodo #1 introduced.)
  const originalTier = settings.updates.tier;

  before(async () => {
    settings.updates.tier = 'manual';
    agent = await common.init();
  });

  after(() => {
    settings.updates.tier = originalTier;
  });

  beforeEach(async () => {
    backups.hooks = {};
    for (const n of authHookNames.concat(failHookNames)) backups.hooks[n] = plugins.hooks[n];
    backups.settings = {};
    for (const k of ['requireAuthentication', 'requireAuthorization', 'users']) {
      backups.settings[k] = (settings as any)[k];
    }
    // Seed a known "update available" state so apply has a target tag.
    await saveState(statePath(), {
      ...EMPTY_STATE,
      latest: {
        version: '99.0.0', tag: 'v99.0.0', body: 'release notes',
        publishedAt: '2099-01-01T00:00:00Z', prerelease: false,
        htmlUrl: 'https://example/r/v99.0.0',
      },
    });
    // Ensure no stale lock from an earlier test.
    try { require('node:fs').unlinkSync(lockPath()); } catch {/* noop */}
  });

  afterEach(() => {
    Object.assign(plugins.hooks, backups.hooks);
    Object.assign(settings, backups.settings);
  });

  describe('POST /admin/update/apply', function () {
    it('rejects unauthenticated', async () => {
      await agent.post('/admin/update/apply').expect(401);
    });

    it('returns 409 with no-known-latest when state has no latest release', async () => {
      installAdminAuth();
      // Replace seeded "update available" with empty state.
      await saveState(statePath(), {...EMPTY_STATE});
      const r = await agent.post('/admin/update/apply')
        .auth('admin', 'admin-pw')
        .expect(409);
      assert.equal(r.body.error, 'no-known-latest');
    });

    it('returns 404 when tier is "notify" (action endpoints disabled)', async () => {
      // Regression for the Tier 2 gate (Qodo #1): disabled tiers must 404 to
      // match prior PR-1 behaviour, not 401/403/409.
      const orig = settings.updates.tier;
      settings.updates.tier = 'notify';
      try {
        await agent.post('/admin/update/apply').expect(404);
        await agent.post('/admin/update/cancel').expect(404);
        await agent.post('/admin/update/acknowledge').expect(404);
        await agent.get('/admin/update/log').expect(404);
      } finally { settings.updates.tier = orig; }
    });

    it('rejects when execution is already in flight (409)', async () => {
      installAdminAuth();
      await saveState(statePath(), {
        ...EMPTY_STATE,
        latest: {
          version: '99.0.0', tag: 'v99.0.0', body: '', publishedAt: '',
          prerelease: false, htmlUrl: '',
        },
        execution: {
          status: 'executing', targetTag: 'v99.0.0', fromSha: 'x',
          startedAt: '2026-05-08T00:00:00Z',
        },
      });
      const r = await agent.post('/admin/update/apply')
        .auth('admin', 'admin-pw')
        .expect(409);
      assert.match(r.body.error, /execution-busy/);
    });
  });

  describe('POST /admin/update/cancel', function () {
    it('rejects unauthenticated', async () => {
      await agent.post('/admin/update/cancel').expect(401);
    });

    it('returns 409 when nothing is in flight', async () => {
      installAdminAuth();
      await agent.post('/admin/update/cancel').auth('admin', 'admin-pw').expect(409);
    });
  });

  describe('POST /admin/update/acknowledge', function () {
    it('rejects unauthenticated', async () => {
      await agent.post('/admin/update/acknowledge').expect(401);
    });

    it('clears a terminal rollback-failed state to idle', async () => {
      installAdminAuth();
      await saveState(statePath(), {
        ...EMPTY_STATE,
        execution: {
          status: 'rollback-failed',
          reason: 'install-failed; rollback failed: pnpm exit 1',
          targetTag: 'v99.0.0', fromSha: 'x',
          at: '2026-05-08T00:00:00Z',
        },
        lastResult: {
          targetTag: 'v99.0.0', fromSha: 'x',
          outcome: 'rollback-failed',
          reason: 'pnpm install failed',
          at: '2026-05-08T00:00:00Z',
        },
      });
      await agent.post('/admin/update/acknowledge')
        .auth('admin', 'admin-pw').expect(200);
      const status = await agent.get('/admin/update/status').expect(200);
      assert.equal(status.body.execution.status, 'idle');
      // lastResult is preserved on acknowledge so the admin still sees what happened.
      assert.equal(status.body.lastResult.outcome, 'rollback-failed');
    });

    it('clears a preflight-failed state to idle', async () => {
      installAdminAuth();
      await saveState(statePath(), {
        ...EMPTY_STATE,
        execution: {
          status: 'preflight-failed',
          targetTag: 'v99.0.0',
          reason: 'low-disk-space',
          at: '2026-05-08T00:00:00Z',
        },
      });
      await agent.post('/admin/update/acknowledge')
        .auth('admin', 'admin-pw').expect(200);
    });

    it('refuses to clear a non-terminal state (409)', async () => {
      installAdminAuth();
      await saveState(statePath(), {...EMPTY_STATE});
      await agent.post('/admin/update/acknowledge')
        .auth('admin', 'admin-pw').expect(409);
    });
  });

  describe('GET /admin/update/log', function () {
    it('rejects unauthenticated', async () => {
      await agent.get('/admin/update/log').expect(401);
    });

    it('returns a text body (possibly empty) for an admin', async () => {
      installAdminAuth();
      const res = await agent.get('/admin/update/log')
        .auth('admin', 'admin-pw').expect(200);
      assert.equal(typeof res.text, 'string');
      assert.match(res.headers['content-type'], /text\/plain/);
    });
  });
});
