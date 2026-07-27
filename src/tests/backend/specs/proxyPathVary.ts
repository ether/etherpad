'use strict';

/**
 * Cache-poisoning hardening for the `x-proxy-path` header on public routes.
 *
 * Etherpad echoes the (sanitised) `x-proxy-path` prefix into rendered URLs,
 * social-preview metadata, PWA manifest links, and the legacy timeslider
 * redirect on `/`, `/p/:pad`, and `/p/:pad/timeslider`. If a shared cache /
 * reverse proxy in front of Etherpad stores these responses keyed on URL alone,
 * a value injected by one client is served to every other client. These
 * responses must therefore advertise `Vary: x-proxy-path` so a conforming cache
 * keeps prefixed and non-prefixed variants separate. Reported by `meifukun`;
 * companion to the already-fixed admin-route variant (GHSA-fjgc-3mj7-8rg8).
 */

const assert = require('assert').strict;
const common = require('../common');
const padManager = require('../../../node/db/PadManager');
import settings from '../../../node/utils/Settings';

let agent: any;

const varyList = (res: any): string[] =>
  String(res.headers.vary || '').toLowerCase().split(',').map((s: string) => s.trim());

const assertVariesOnProxyPath = (res: any, where: string) => {
  if (!varyList(res).includes('x-proxy-path')) {
    throw new Error(
        `${where}: response must advertise "Vary: x-proxy-path" so a shared ` +
        `cache cannot serve a poisoned proxy-path to another user ` +
        `(got Vary: "${res.headers.vary || ''}")`);
  }
};

describe(__filename, function () {
  this.timeout(30000);
  const padId = 'ProxyPathVaryTest';
  let trustProxyBackup: any;

  before(async function () {
    agent = await common.init();
    await padManager.getPad(padId, 'test content');
    trustProxyBackup = settings.trustProxy;
  });

  after(function () {
    settings.trustProxy = trustProxyBackup;
  });

  it('sets Vary: x-proxy-path on the home page', async function () {
    const res = await agent.get('/').expect(200);
    assertVariesOnProxyPath(res, 'GET /');
  });

  it('sets Vary: x-proxy-path on the pad page', async function () {
    const res = await agent.get(`/p/${padId}`).expect(200);
    assertVariesOnProxyPath(res, `GET /p/${padId}`);
  });

  it('sets Vary: x-proxy-path on the timeslider embed page', async function () {
    const res = await agent.get(`/p/${padId}/timeslider?embed=1`).expect(200);
    assertVariesOnProxyPath(res, `GET /p/${padId}/timeslider?embed=1`);
  });

  it('sets Vary: x-proxy-path on the legacy timeslider redirect', async function () {
    const res = await agent.get(`/p/${padId}/timeslider`).expect(302);
    assertVariesOnProxyPath(res, `GET /p/${padId}/timeslider (redirect)`);
  });

  it('does NOT vary on the trust-gated headers when trustProxy is false', async function () {
    // sanitizeProxyPath ignores x-forwarded-prefix / x-ingress-path unless
    // trustProxy is enabled, so varying on them would only fragment caches.
    settings.trustProxy = false;
    const res = await agent.get('/').expect(200);
    const vary = varyList(res);
    assert.ok(vary.includes('x-proxy-path'), `expected x-proxy-path, got "${res.headers.vary}"`);
    assert.ok(!vary.includes('x-forwarded-prefix'),
        `must not vary on x-forwarded-prefix when trustProxy=false (got "${res.headers.vary}")`);
    assert.ok(!vary.includes('x-ingress-path'),
        `must not vary on x-ingress-path when trustProxy=false (got "${res.headers.vary}")`);
  });

  it('varies on all proxy-path headers when trustProxy is true', async function () {
    settings.trustProxy = true;
    const res = await agent.get('/').expect(200);
    const vary = varyList(res);
    assert.ok(vary.includes('x-proxy-path'), `expected x-proxy-path, got "${res.headers.vary}"`);
    assert.ok(vary.includes('x-forwarded-prefix'),
        `expected x-forwarded-prefix when trustProxy=true (got "${res.headers.vary}")`);
    assert.ok(vary.includes('x-ingress-path'),
        `expected x-ingress-path when trustProxy=true (got "${res.headers.vary}")`);
  });
});
