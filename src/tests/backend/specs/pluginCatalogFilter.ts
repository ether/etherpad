'use strict';

import {strict as assert} from 'assert';
import {
  catalogExclusion,
  filterCatalogEntries,
  normalizeDeprecation,
  supersededPlugins,
} from '../../../static/js/pluginfw/pluginCatalogFilter';

// Regression tests for #8246: the admin "Available plugins" catalog offered
// every package in the plugin feed, including packages that are deprecated on
// npm, packages the plugin registry itself could not get working, and
// ep_adminpads2 — which installs cleanly and then breaks the admin UI. These
// assertions pin the decision table so a future refactor cannot quietly start
// offering broken plugins again, and — just as important — cannot start
// hiding healthy ones.
describe(__filename, function () {
  describe('normalizeDeprecation', function () {
    it('treats a non-empty message as deprecated', function () {
      assert.equal(normalizeDeprecation('use ep_guest instead'), 'use ep_guest instead');
    });

    it('treats the legacy boolean true as deprecated', function () {
      assert.equal(normalizeDeprecation(true), 'Deprecated on npm.');
    });

    it('treats undefined, false and empty/whitespace strings as not deprecated', function () {
      // npm leaves `deprecated: ""` (or removes the field) when a package is
      // un-deprecated. Reading that as "deprecated" would hide a healthy
      // package from the catalog.
      for (const raw of [undefined, null, false, '', '   ']) {
        assert.equal(normalizeDeprecation(raw), null, `value: ${JSON.stringify(raw)}`);
      }
    });
  });

  describe('catalogExclusion', function () {
    it('keeps a healthy plugin', function () {
      assert.equal(
          catalogExclusion({name: 'ep_align', compatibility: 'compatible'}, null), null);
    });

    it('keeps a plugin whose deprecation state could not be determined', function () {
      // `undefined` is what a failed npm lookup produces. Fail open.
      assert.equal(
          catalogExclusion({name: 'ep_align', compatibility: 'compatible'}, undefined), null);
    });

    it('hides a plugin npm marks deprecated, carrying the upstream message', function () {
      const out = catalogExclusion(
          {name: 'ep_readonly_guest', compatibility: 'compatible'}, 'superseded by ep_guest');
      assert.equal(out!.cause, 'deprecated');
      assert.equal(out!.detail, 'superseded by ep_guest');
    });

    it('hides ep_adminpads2, which breaks the admin UI it claims to extend', function () {
      const out = catalogExclusion(
          {name: 'ep_adminpads2', version: '2.1.110', compatibility: 'compatible'}, null);
      assert.equal(out!.cause, 'superseded');
      assert.match(out!.detail, /admin/i);
    });

    it('hides a plugin the registry flagged as failing against current Etherpad', function () {
      const out = catalogExclusion({name: 'ep_kaput', compatibility: 'failed'}, null);
      assert.equal(out!.cause, 'incompatible');
    });

    it('still offers a plugin the registry only warned about', function () {
      assert.equal(catalogExclusion({name: 'ep_discordauth', compatibility: 'warning'}, null), null);
    });

    it('offers a plugin with no compatibility field at all', function () {
      // Self-hosted or older feeds may not carry the field. Absence is not
      // evidence of breakage.
      assert.equal(catalogExclusion({name: 'ep_align'}, null), null);
    });

    it('tolerates malformed entries instead of throwing', function () {
      assert.equal(catalogExclusion(undefined as any, null), null);
      assert.equal(catalogExclusion({} as any, null), null);
      assert.equal(catalogExclusion({name: 42 as any}, null), null);
    });
  });

  describe('filterCatalogEntries', function () {
    const catalog = () => ({
      ep_align: {name: 'ep_align', version: '11.0.43', compatibility: 'compatible'},
      ep_adminpads2: {name: 'ep_adminpads2', version: '2.1.110', compatibility: 'compatible'},
      ep_kaput: {name: 'ep_kaput', version: '0.0.18', compatibility: 'failed'},
      ep_old: {name: 'ep_old', version: '1.0.0', compatibility: 'compatible'},
    });

    it('keeps the healthy plugins and reports why the others went', function () {
      const {kept, excluded} = filterCatalogEntries(
          catalog(), new Map([['ep_old', 'no longer maintained'], ['ep_align', null]]));
      assert.deepEqual(Object.keys(kept), ['ep_align']);
      assert.deepEqual([...excluded.keys()].sort(), ['ep_adminpads2', 'ep_kaput', 'ep_old']);
      assert.equal(excluded.get('ep_old')!.cause, 'deprecated');
      assert.equal(excluded.get('ep_kaput')!.cause, 'incompatible');
      assert.equal(excluded.get('ep_adminpads2')!.cause, 'superseded');
    });

    it('with no deprecation data at all, only the feed signals apply', function () {
      // This is the offline / npm-unreachable case: the catalog must still
      // list everything except what the feed itself condemns.
      const {kept} = filterCatalogEntries(catalog());
      assert.deepEqual(Object.keys(kept).sort(), ['ep_align', 'ep_old']);
    });

    it('does not mutate the input catalog', function () {
      const input = catalog();
      filterCatalogEntries(input, new Map([['ep_old', 'gone']]));
      assert.deepEqual(Object.keys(input).sort(),
          ['ep_adminpads2', 'ep_align', 'ep_kaput', 'ep_old']);
    });
  });

  describe('supersededPlugins list', function () {
    it('documents a reason for every entry so stale entries can be retired', function () {
      assert.ok(supersededPlugins.size > 0);
      for (const [name, reason] of supersededPlugins) {
        assert.ok(name.startsWith('ep_'), `${name} is not a plugin name`);
        assert.ok(reason.length > 40, `${name} needs an explanation, got: ${reason}`);
      }
    });
  });
});
