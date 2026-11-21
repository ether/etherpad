'use strict';

import {strict as assert} from 'assert';
import sinon from 'sinon';
import {
  clearDeprecationCache,
  fetchPluginDeprecations,
  getAvailablePlugins,
  getBrowsablePlugins,
  getInstalledPluginWarnings,
  install,
  linkInstaller,
  search,
} from '../../../static/js/pluginfw/installer';
import {OFFICIAL_GITHUB_OWNER_ID} from '../../../static/js/pluginfw/pluginTrust';
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

  type AttestationBehaviour = (name: string, version: string) => unknown;

  const stubFetch = (
    npm: NpmBehaviour,
    {feedBody = feed as Record<string, unknown>, attestations}:
      {feedBody?: Record<string, unknown>, attestations?: AttestationBehaviour} = {},
  ) => sinon.stub(global, 'fetch')
      .callsFake(async (input: any) => {
        const url = String(input);
        if (url === feedUrl) return jsonResponse(feedBody) as any;
        const att = /\/-\/npm\/v1\/attestations\/(.+)@([^@]+)$/.exec(url);
        if (att && url.startsWith(`${npmRegistry}/`)) {
          const body = attestations ? attestations(att[1], att[2]) : undefined;
          if (body instanceof Error) throw body;
          if (body === undefined) return {ok: false, status: 404, statusText: 'Not Found'} as any;
          return jsonResponse(body) as any;
        }
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
  describe('official vs third-party (pluginTrust.ts)', function () {
    // An SRI hash and the matching in-toto hex digest; any 64 bytes will do.
    const bytes = Buffer.alloc(64, 7);
    const integrity = `sha512-${bytes.toString('base64')}`;
    const digest = bytes.toString('hex');

    const provenance = (name: string, version: string, repository: string) => ({
      attestations: [{
        predicateType: 'https://slsa.dev/provenance/v1',
        bundle: {dsseEnvelope: {payload: Buffer.from(JSON.stringify({
          _type: 'https://in-toto.io/Statement/v1',
          subject: [{name: `pkg:npm/${name}@${version}`, digest: {sha512: digest}}],
          predicateType: 'https://slsa.dev/provenance/v1',
          predicate: {buildDefinition: {
            externalParameters: {workflow: {repository}},
            internalParameters: {github: {repository_owner_id: OFFICIAL_GITHUB_OWNER_ID}},
          }},
        })).toString('base64')}},
      }],
    });

    const trustFeed = {
      ep_align: {name: 'ep_align', description: 'Alignment', time: '2026-07-01',
        version: '11.0.43', official: true, compatibility: 'compatible'},
      ep_liar: {name: 'ep_liar', description: 'Claims to be official', time: '2026-11-21',
        version: '1.0.0', official: true, compatibility: 'compatible'},
      ep_community: {name: 'ep_community', description: 'A real third-party plugin',
        time: '2026-01-01', version: '2.0.0', official: false, compatibility: 'compatible'},
      ep_nxs65012: {name: 'ep_nxs65012', description: '', time: '2026-11-21',
        version: '0.0.0-stage', official: false, compatibility: 'compatible'},
      ep_norepo: {name: 'ep_norepo', description: 'no repository', time: '2026-11-21',
        version: '1.0.0', official: false, compatibility: 'compatible'},
    };

    const npmMeta = (name: string, version: string) => {
      const base: any = {name, version, dist: {integrity}};
      if (name !== 'ep_norepo' && name !== 'ep_nxs65012') {
        base.repository = {type: 'git', url: `git+https://github.com/ether/${name}.git`};
      }
      if (name === 'ep_align' || name === 'ep_liar') {
        base.dist.attestations = {
          url: `${npmRegistry}/-/npm/v1/attestations/${name}@${version}`,
          provenance: {predicateType: 'https://slsa.dev/provenance/v1'},
        };
      }
      return base;
    };

    const attestations = (name: string, version: string) => (name === 'ep_align'
      ? provenance(name, version, 'https://github.com/ether/ep_align')
      // ep_liar declares an ether repository in package.json, but its
      // provenance shows where it was really built.
      : provenance(name, version, 'https://github.com/nx-zd/ep_liar'));

    let savedMode: string;
    beforeEach(function () {
      savedMode = settings.pluginCatalogThirdParty;
    });
    afterEach(function () {
      settings.pluginCatalogThirdParty = savedMode;
    });

    const names = (res: Record<string, unknown>) => Object.keys(res).sort();

    it('marks only plugins with ether provenance as official', async function () {
      stubFetch(npmMeta, {feedBody: trustFeed, attestations});
      const available = await getAvailablePlugins(false);
      assert.equal(available.ep_align.official, true);
      assert.equal(available.ep_liar.official, false,
          'the feed flag and package.json repository must not make a plugin official');
      assert.equal(available.ep_community.official, false);
      assert.equal(available.ep_nxs65012.placeholder, true);
      assert.equal(available.ep_norepo.placeholder, true);
      assert.equal(available.ep_community.placeholder, false);
    });

    it('caches provenance, so a refresh does not refetch attestations', async function () {
      const fetchStub = stubFetch(npmMeta, {feedBody: trustFeed, attestations});
      await getAvailablePlugins(false);
      const attCalls = () => fetchStub.getCalls()
          .filter((c) => String(c.args[0]).includes('/-/npm/v1/attestations/')).length;
      assert.equal(attCalls(), 2);
      await getAvailablePlugins(false);
      assert.equal(attCalls(), 2);
    });

    it('treats every plugin as third-party when npm is unreachable', async function () {
      stubFetch(() => new Error('offline'), {feedBody: trustFeed});
      const available = await getAvailablePlugins(false);
      for (const entry of Object.values(available)) assert.equal(entry.official, false);
      // The 0.0.0 placeholder is still recognised from the feed alone; the
      // repository check needs npm, so it fails open.
      assert.equal(available.ep_nxs65012.placeholder, true);
      assert.equal(available.ep_norepo.placeholder, false);
    });

    it('label (default): hides placeholders from browsing, keeps third-party', async function () {
      settings.pluginCatalogThirdParty = 'label';
      stubFetch(npmMeta, {feedBody: trustFeed, attestations});
      assert.deepEqual(names(await search('', 0)), ['ep_align', 'ep_community', 'ep_liar']);
      assert.deepEqual(names(await search('nxs', 0)), []);
    });

    it('label: an exact-name search finds a placeholder', async function () {
      settings.pluginCatalogThirdParty = 'label';
      stubFetch(npmMeta, {feedBody: trustFeed, attestations});
      assert.deepEqual(names(await search('ep_nxs65012', 0)), ['ep_nxs65012']);
      assert.deepEqual(names(await search('EP_NOREPO', 0)), ['ep_norepo']);
    });

    it('hide: lists official plugins only', async function () {
      settings.pluginCatalogThirdParty = 'hide';
      stubFetch(npmMeta, {feedBody: trustFeed, attestations});
      assert.deepEqual(names(await search('', 0)), ['ep_align']);
      assert.deepEqual(names(await search('ep_community', 0)), []);
    });

    it('all: lists everything', async function () {
      settings.pluginCatalogThirdParty = 'all';
      stubFetch(npmMeta, {feedBody: trustFeed, attestations});
      assert.deepEqual(names(await search('', 0)), Object.keys(trustFeed).sort());
    });
    it('getAvailable (browsing) applies the same policy as search', async function () {
      settings.pluginCatalogThirdParty = 'label';
      stubFetch(npmMeta, {feedBody: trustFeed, attestations});
      assert.deepEqual(names(await getBrowsablePlugins(false)),
          ['ep_align', 'ep_community', 'ep_liar']);
      settings.pluginCatalogThirdParty = 'hide';
      assert.deepEqual(names(await getBrowsablePlugins(false)), ['ep_align']);
    });

    it('the deprecation-only lookup does not fetch attestations', async function () {
      const fetchStub = stubFetch(npmMeta, {feedBody: trustFeed, attestations});
      await fetchPluginDeprecations([{name: 'ep_align', version: '11.0.43'}]);
      const attCalls = fetchStub.getCalls()
          .filter((c) => String(c.args[0]).includes('/-/npm/v1/attestations/'));
      assert.equal(attCalls.length, 0);
    });

    it('provenance fetched later reuses the cached metadata', async function () {
      const fetchStub = stubFetch(npmMeta, {feedBody: trustFeed, attestations});
      await fetchPluginDeprecations([{name: 'ep_align', version: '11.0.43'}]);
      const metaCalls = () => fetchStub.getCalls()
          .filter((c) => String(c.args[0]).endsWith('/ep_align/11.0.43')).length;
      assert.equal(metaCalls(), 1);
      const available = await getAvailablePlugins(false);
      assert.equal(available.ep_align.official, true);
      assert.equal(metaCalls(), 1);
    });

    it('retries a catalog whose provenance could not be checked sooner', async function () {
      let attestationsDown = true;
      const fetchStub = stubFetch(npmMeta, {feedBody: trustFeed,
        attestations: (n, v) => (attestationsDown ? new Error('timeout') : attestations(n, v))});
      const feedCalls = () =>
        fetchStub.getCalls().filter((c) => String(c.args[0]) === feedUrl).length;
      const first = await getAvailablePlugins(false);
      assert.equal(first.ep_align.official, false, 'unknown is never official');
      const realNow = Date.now;
      const start = realNow();
      try {
        // Two minutes later: inside the normal 10-minute cache, past the
        // 1-minute limit for a catalog with unchecked provenance.
        sinon.stub(Date, 'now').returns(start + 2 * 60 * 1000);
        attestationsDown = false;
        const second = await getAvailablePlugins(600);
        assert.equal(feedCalls(), 2, 'an incomplete catalog must be refreshed');
        assert.equal(second.ep_align.official, true);
        (Date.now as sinon.SinonStub).returns(start + 4 * 60 * 1000);
        await getAvailablePlugins(600);
        assert.equal(feedCalls(), 2, 'a complete catalog is cached as before');
      } finally {
        (Date.now as any).restore?.();
      }
    });
  });

  describe('install pins the version the catalog showed', function () {
    const installOnce = (name: string, version?: string) => new Promise<any>(
        (resolve) => install(name, (err: any) => resolve(err), version));

    it('passes the requested version to the installer and to the npm checks', async function () {
      const fetchStub = stubFetch(() => ({engines: {node: '>=18'}}));
      // Rejecting keeps the install from "succeeding", which would persist
      // installed_plugins.json and fire the restartServer hook.
      const installStub = sinon.stub(linkInstaller, 'installPlugin')
          .rejects(new Error('stop here'));
      const err = await installOnce('ep_align', '11.0.43');
      assert.match(String(err), /stop here/);
      assert.deepEqual(installStub.firstCall.args, ['ep_align', '11.0.43']);
      assert.ok(fetchStub.getCalls().some((c) => String(c.args[0]).endsWith('/ep_align/11.0.43')));
    });

    it('refuses a version that is not a plain semver', async function () {
      stubFetch(() => ({}));
      const installStub = sinon.stub(linkInstaller, 'installPlugin').resolves();
      const err = await installOnce('ep_align', 'latest; rm -rf /');
      assert.match(String(err), /Invalid version/);
      assert.equal(installStub.callCount, 0);
    });
  });
});
