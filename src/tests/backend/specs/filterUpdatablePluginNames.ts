'use strict';

import {strict as assert} from 'assert';
import {filterUpdatablePluginNames} from '../../../../bin/commonPlugins';

// Regression test for #6670: the bug fix in `pnpm run plugins update` reads
// var/installed_plugins.json and re-invokes the installer per entry. The
// filter that picks safe-to-install names lives in bin/commonPlugins so that
// it is testable in isolation — the script itself has top-level side
// effects. If the filter ever regresses (skipping ep_ validation, allowing
// ep_etherpad-lite back in, dropping de-dup, choking on bad shapes) these
// assertions fail before the broken behaviour can ship.
describe(__filename, function () {
  it('keeps every ep_-prefixed plugin name verbatim', function () {
    const out = filterUpdatablePluginNames([
      {name: 'ep_align'},
      {name: 'ep_markdown'},
      {name: 'ep_headings2'},
    ]);
    assert.deepEqual(out, ['ep_align', 'ep_markdown', 'ep_headings2']);
  });

  it('drops ep_etherpad-lite because the core is vendored, not plugin-installed', function () {
    const out = filterUpdatablePluginNames([
      {name: 'ep_etherpad-lite'},
      {name: 'ep_align'},
    ]);
    assert.deepEqual(out, ['ep_align']);
  });

  it('rejects names without the ep_ prefix so a corrupted manifest cannot install arbitrary packages', function () {
    const out = filterUpdatablePluginNames([
      {name: 'ep_align'},
      {name: 'malicious-package'},
      {name: 'lodash'},
      {name: '../../../etc/passwd'},
    ]);
    assert.deepEqual(out, ['ep_align']);
  });

  it('de-duplicates repeated names so each plugin is installed at most once', function () {
    const out = filterUpdatablePluginNames([
      {name: 'ep_align'},
      {name: 'ep_align'},
      {name: 'ep_markdown'},
      {name: 'ep_align'},
    ]);
    assert.deepEqual(out, ['ep_align', 'ep_markdown']);
  });

  it('tolerates missing, null, or non-string name fields', function () {
    const out = filterUpdatablePluginNames([
      {name: 'ep_align'},
      {},
      null,
      undefined,
      {name: null as unknown as string},
      {name: 42 as unknown as string},
      {name: 'ep_markdown'},
    ]);
    assert.deepEqual(out, ['ep_align', 'ep_markdown']);
  });

  it('returns an empty array for an empty manifest', function () {
    assert.deepEqual(filterUpdatablePluginNames([]), []);
  });

  it('honours a custom prefix when one is supplied (defends against hard-coding)', function () {
    const out = filterUpdatablePluginNames(
      [{name: 'foo_one'}, {name: 'ep_align'}, {name: 'foo_two'}],
      'foo_',
    );
    assert.deepEqual(out, ['foo_one', 'foo_two']);
  });
});
