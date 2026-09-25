'use strict';

import {strict as assert} from 'assert';
import sinon from 'sinon';
import {
  clearDeprecationCache,
  fetchPluginDeprecations,
  getAvailablePlugins,
  getInstalledPluginWarnings,
  install,
} from '../../../static/js/pluginfw/installer';
import settings from '../../../node/utils/Settings';

/**
 * End-to-end cover for the #8246 catalog filter: what the admin UI is
 * offered after `getAvailablePlugins()` has talked to the plugin feed and to
 * the npm registry. `global.fetch` is stubbed so no test touches the network.
 */
describe(__filename, function () {
  const feedUrl = `${settings.updateServer}/plugins.json`;
  const npmRegistry = 'https://registry.npmjs.org';

  // A miniature plugins.json, shaped exactly like the live feed: name,
  // description, time, version, official, downloads, compatibility.
  const feed = {
    ep_align: {
      name: 'ep_align',
      description: 'Alignment',
      time: '2026-07-01',
      version: '11.0.43',
      official: true,
      downloads: 6784,
      compatibility: 'compatible',
    },
    ep_adminpads2: {
      name: 'ep_adminpads2',
      description: 'Etherpad plugin to list and delete pads in /admin.',
      time: '2025-01-06',
      version: '2.1.110',
      official: true,
      downloads: 655,
      compatibility: 'compatible',
    },
    ep_stale: {
      name: 'ep_stale',
      description: 'Deprecated on npm',
      time: '2022-01-01',
      version: '1.0.0',
      official: false,
      downloads: 3,
      compatibility: 'compatible',
    },
    ep_broken: {
      name: 'ep_broken',
      description: 'Registry could not get this working',
      time: '2022-01-01',
      version: '0.0.1',
      official: false,
      downloads: 3,
      compatibility: 'failed',
    },
  };

  const jsonResponse = (body: unknown) => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => body,
  });

  type NpmBehaviour = (name: string, version: string) => unknown;

  const stubFetch = (npm: NpmBehaviour) => sinon.stub(global, 'fetch')
      .callsFake(async (input: any) => {
        const url = String(input);
        if (url === feedUrl) return jsonResponse(feed) as any;
        const m = url.startsWith(`${npmRegistry}/`)
          ? /\/([^/]+)\/([^/]+)$/.exec(url)
          : null;
        if (m) {
          const body = npm(decodeURIComponent(m[1]), decodeURIComponent(m[2]));
          if (body instanceof Error) throw body;
          if (body === undefined) return {ok: false, status: 404, statusText: 'Not Found'} as any;
          return jsonResponse(body) as any;
        }
        throw new Error(`unexpected fetch: ${url}`);
      });

  beforeEach(function () {
    clearDeprecationCache();
  });

  afterEach(function () {
    sinon.restore();
    clearDeprecationCache();
  });

  it('excludes a package npm marks deprecated and keeps the healthy ones', async function () {
    stubFetch((name) => (name === 'ep_stale'
      ? {deprecated: 'unmaintained, use ep_align'}
      : {engines: {node: '>=18'}}));
    const available = await getAvailablePlugins(false);
    assert.ok(available.ep_align, 'a healthy plugin must still be listed');
    assert.equal(available.ep_stale, undefined, 'deprecated plugin must not be offered');
  });

  it('excludes ep_adminpads2, the plugin that breaks the admin UI (#8246)', async function () {
    stubFetch(() => ({}));
    const available = await getAvailablePlugins(false);
    assert.equal(available.ep_adminpads2, undefined);
  });

  it('excludes a package the feed flags as incompatible', async function () {
    stubFetch(() => ({}));
    const available = await getAvailablePlugins(false);
    assert.equal(available.ep_broken, undefined);
  });

  it('still lists plugins when the npm registry is unreachable', async function () {
    // The important failure mode: an Etherpad behind a firewall that can
    // reach the update server but not npm must get a working catalog, not an
    // empty one.
    stubFetch(() => new Error('ENOTFOUND registry.npmjs.org'));
    const available = await getAvailablePlugins(false);
    assert.deepEqual(Object.keys(available).sort(), ['ep_align', 'ep_stale']);
  });

  it('still lists plugins when npm answers 404 for a package', async function () {
    stubFetch(() => undefined);
    const available = await getAvailablePlugins(false);
    assert.deepEqual(Object.keys(available).sort(), ['ep_align', 'ep_stale']);
  });

  it('propagates a plugin-feed failure instead of returning an empty catalog', async function () {
    sinon.stub(global, 'fetch').callsFake(async () => ({
      ok: false, status: 503, statusText: 'Service Unavailable',
    }) as any);
    await assert.rejects(getAvailablePlugins(false), /HTTP 503/);
  });

  it('shares one refresh between concurrent callers', async function () {
    // The admin page fires `getInstalled` (which checks for updates) and
    // `search` at the same time. Without sharing the in-flight refresh both
    // would fetch the feed and sweep npm for the whole catalog.
    const fetchStub = stubFetch(() => ({}));
    const [a, b] = await Promise.all([getAvailablePlugins(false), getAvailablePlugins(false)]);
    assert.deepEqual(Object.keys(a).sort(), Object.keys(b).sort());
    const feedCalls = fetchStub.getCalls().filter((c) => String(c.args[0]) === feedUrl);
    assert.equal(feedCalls.length, 1, 'the feed must be fetched once for both callers');
    const npmCalls = fetchStub.getCalls()
        .filter((c) => String(c.args[0]).startsWith(`${npmRegistry}/`));
    assert.equal(npmCalls.length, Object.keys(feed).length, 'one npm lookup per listed plugin');
  });

  it('does not pin later callers to a failed refresh', async function () {
    const failing = sinon.stub(global, 'fetch').callsFake(async () => {
      throw new Error('feed down');
    });
    await assert.rejects(getAvailablePlugins(false));
    failing.restore();
    stubFetch(() => ({}));
    const available = await getAvailablePlugins(false);
    assert.ok(available.ep_align);
  });

  describe('install refuses what the catalog will not offer', function () {
    const installOnce = (name: string) => new Promise<any>(
        (resolve) => install(name, (err: any) => resolve(err)));

    it('refuses a superseded plugin without asking npm', async function () {
      const fetchStub = stubFetch(() => ({}));
      const err = await installOnce('ep_adminpads2');
      assert.equal(err.code, 'PLUGIN_DEPRECATED');
      assert.equal(fetchStub.callCount, 0, 'the block must hold with no network');
    });

    it('refuses a plugin npm marks deprecated', async function () {
      stubFetch(() => ({deprecated: 'unmaintained'}));
      const err = await installOnce('ep_stale');
      assert.equal(err.code, 'PLUGIN_DEPRECATED');
      assert.match(err.message, /unmaintained/);
    });
  });

  describe('getInstalledPluginWarnings', function () {
    it('flags an installed plugin that is deprecated or superseded', async function () {
      stubFetch((name) => (name === 'ep_stale' ? {deprecated: 'unmaintained'} : {}));
      const warnings = await getInstalledPluginWarnings([
        {name: 'ep_align', version: '11.0.43'},
        {name: 'ep_stale', version: '1.0.0'},
        {name: 'ep_adminpads2', version: '2.1.110'},
      ]);
      assert.equal(warnings.has('ep_align'), false);
      assert.equal(warnings.get('ep_stale'), 'unmaintained');
      assert.match(warnings.get('ep_adminpads2')!, /admin/i);
    });

    it('never asks npm about core, and never flags it', async function () {
      // ep_etherpad-lite is vendored, not installed from the registry.
      const fetchStub = stubFetch(() => ({deprecated: 'should not be consulted'}));
      const warnings = await getInstalledPluginWarnings([
        {name: 'ep_etherpad-lite', version: '3.3.5'},
      ]);
      assert.equal(warnings.size, 0);
      assert.equal(fetchStub.callCount, 0);
    });

    it('reports nothing when npm cannot be reached', async function () {
      stubFetch(() => new Error('offline'));
      const warnings = await getInstalledPluginWarnings([{name: 'ep_align', version: '1.0.0'}]);
      assert.equal(warnings.size, 0);
    });
  });

  describe('fetchPluginDeprecations', function () {
    it('asks npm for the exact version the catalog would offer', async function () {
      const fetchStub = stubFetch(() => ({}));
      await fetchPluginDeprecations([{name: 'ep_align', version: '11.0.43'}]);
      const urls = fetchStub.getCalls().map((c) => String(c.args[0]));
      assert.ok(urls.some((u) => u.endsWith('/ep_align/11.0.43')), urls.join('\n'));
    });

    it('caches results so a catalog refresh does not re-query npm', async function () {
      const fetchStub = stubFetch(() => ({deprecated: 'gone'}));
      const first = await fetchPluginDeprecations([{name: 'ep_stale', version: '1.0.0'}]);
      const callsAfterFirst = fetchStub.callCount;
      const second = await fetchPluginDeprecations([{name: 'ep_stale', version: '1.0.0'}]);
      assert.equal(first.get('ep_stale'), 'gone');
      assert.equal(second.get('ep_stale'), 'gone');
      assert.equal(fetchStub.callCount, callsAfterFirst, 'second lookup must be served from cache');
    });

    it('does not cache a failed lookup, so it can recover later', async function () {
      let fail = true;
      stubFetch(() => (fail ? new Error('offline') : {deprecated: 'gone'}));
      const first = await fetchPluginDeprecations([{name: 'ep_stale', version: '1.0.0'}]);
      assert.equal(first.has('ep_stale'), false, 'unknown, not "healthy"');
      fail = false;
      const second = await fetchPluginDeprecations([{name: 'ep_stale', version: '1.0.0'}]);
      assert.equal(second.get('ep_stale'), 'gone');
    });
  });
});
