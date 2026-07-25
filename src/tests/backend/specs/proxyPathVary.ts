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

const common = require('../common');
const padManager = require('../../../node/db/PadManager');

let agent: any;

const assertVariesOnProxyPath = (res: any, where: string) => {
  const vary = String(res.headers.vary || '').toLowerCase();
  if (!vary.split(',').map((s: string) => s.trim()).includes('x-proxy-path')) {
    throw new Error(
        `${where}: response must advertise "Vary: x-proxy-path" so a shared ` +
        `cache cannot serve a poisoned proxy-path to another user ` +
        `(got Vary: "${res.headers.vary || ''}")`);
  }
};

describe(__filename, function () {
  this.timeout(30000);
  const padId = 'ProxyPathVaryTest';

  before(async function () {
    agent = await common.init();
    await padManager.getPad(padId, 'test content');
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
});
