'use strict';

// Source-level lint: every user-facing string in admin/src/pages and
// admin/src/App.tsx must go through react-i18next (t()/<Trans>). PR #7716
// shipped the new admin UI with ~50+ literal German strings, which produced
// a French/English/German salad for non-DE users (issue #7735). This test
// catches that class of regression in CI without needing a live server —
// the matching Playwright spec at admin-spec/admini18n.spec.ts exercises
// the rendered output.

import {readFileSync} from 'fs';
import {join} from 'path';
import {describe, it, expect} from 'vitest';

const repoRoot = join(__dirname, '..', '..', '..', '..');
const read = (rel: string) => readFileSync(join(repoRoot, rel), 'utf8');

// Stripped of code-fence quirks, but JSX text nodes and quoted string props
// are caught by the same heuristic: a German word adjacent to user-facing
// JSX/JS context. The list is short and targets the words that landed in
// PR #7716; expand when new locale-specific words leak in.
const FORBIDDEN_LITERALS = [
  'verfügbar', 'Diagnose', 'kopieren', 'Aktualisieren', 'Zurück', 'Weiter',
  'Beliebt', 'Beliebteste', 'Übersicht', 'aufräumen', 'Löschen', 'Öffnen',
  'gefunden', 'Veraltet', 'Diese Woche', 'noch nie', 'gerade eben',
  'gerade aktiv', 'Aktive Nutzer', 'Hook-Bindings', 'Pads gesamt',
  'Letzte Aktivität', 'Plugin-Quelle', 'Katalog neu laden', 'Auf npm suchen',
  'Nach Updates suchen', 'Auf dem neuesten', 'System-Diagnose',
  'Keine Pads', 'Keine Hooks', 'Auswahl aufheben', 'ausgewählt',
  'Hook oder Teil',
];

// Files we audit. Keep tight — generated/vendor code is excluded.
const AUDITED = [
  'admin/src/App.tsx',
  'admin/src/pages/HomePage.tsx',
  'admin/src/pages/HelpPage.tsx',
  'admin/src/pages/PadPage.tsx',
  'admin/src/pages/SettingsPage.tsx',
  'admin/src/pages/LoginScreen.tsx',
  'admin/src/pages/UpdatePage.tsx',
  'admin/src/pages/ShoutPage.tsx',
];

describe('admin i18n source lint', () => {
  for (const rel of AUDITED) {
    it(`${rel} contains no hardcoded German user-facing strings`, () => {
      const src = read(rel);
      const hits: string[] = [];
      for (const word of FORBIDDEN_LITERALS) {
        if (src.includes(word)) hits.push(word);
      }
      expect(hits, `${rel} contains forbidden literals: ${hits.join(', ')}`)
        .toEqual([]);
    });
  }

  it('PadPage no longer hardcodes de-DE locale formatters', () => {
    const src = read('admin/src/pages/PadPage.tsx');
    expect(src.includes("'de-DE'"), 'PadPage still calls toLocale*("de-DE", ...)')
      .toBe(false);
  });

  it('PadPage sanitises i18n.language before passing to Intl', () => {
    // Qodo finding: i18n.language flows from user-controlled ?lng= and a
    // malformed tag would throw RangeError in toLocale*(). Guard the
    // sanitiser pattern so a future refactor cannot quietly remove it.
    const src = read('admin/src/pages/PadPage.tsx');
    expect(src.includes('sanitizeLocale'),
      'PadPage no longer wraps i18n.language in sanitizeLocale()').toBe(true);
    expect(src.includes('Intl.DateTimeFormat.supportedLocalesOf'),
      'sanitizeLocale no longer validates via Intl.supportedLocalesOf').toBe(true);
  });

  it('PluginDef no longer exposes the dead downloads field', () => {
    // Backend (src/static/js/pluginfw/installer.ts::search) never populates
    // downloads. PR #7716 wired it through the frontend anyway, producing a
    // dead Downloads column, "Most popular" default sort, and a "Popular"
    // tag that never appeared. Guard the cleanup.
    const src = read('admin/src/pages/Plugin.ts');
    expect(src.match(/downloads\??:\s*number/),
      'PluginDef still declares downloads — dead UI field').toBeNull();
    expect(src.includes("'downloads'"),
      "SearchParams['sortBy'] still includes 'downloads'").toBe(false);
  });

  it('SearchField + sorting modules exist and are consumed by AuthorPage', () => {
    // History: PR #7716 (admin design rework) dropped the last consumer of
    // these helpers, then PR #7736 deleted both modules calling them
    // "orphans". PR #7667 (GDPR author-erasure) merged afterwards from an
    // older base and reintroduced imports of SearchField + determineSorting
    // in admin/src/pages/AuthorPage.tsx, breaking the admin build on
    // develop. The files have been restored; this test pins both the file
    // presence and the AuthorPage consumption so a future "orphan" sweep
    // cannot quietly remove them again without also updating AuthorPage.
    const fs = require('fs');
    const join = require('path').join;
    expect(fs.existsSync(join(repoRoot, 'admin/src/components/SearchField.tsx')),
      'admin/src/components/SearchField.tsx is missing — AuthorPage imports it').toBe(true);
    expect(fs.existsSync(join(repoRoot, 'admin/src/utils/sorting.ts')),
      'admin/src/utils/sorting.ts is missing — AuthorPage imports determineSorting from it').toBe(true);
    const authorPage = read('admin/src/pages/AuthorPage.tsx');
    expect(authorPage.includes("from \"../components/SearchField.tsx\""),
      'AuthorPage no longer imports SearchField — delete SearchField.tsx too').toBe(true);
    expect(authorPage.includes("from \"../utils/sorting.ts\""),
      'AuthorPage no longer imports determineSorting — delete sorting.ts too').toBe(true);
  });

  it('PadPage sort dropdown is paired with a direction toggle', () => {
    // PR #7716 hardcoded `ascending: e.target.value === 'padName'`, leaving
    // no way to invert sort direction. The fix is an explicit ↑/↓ button.
    const src = read('admin/src/pages/PadPage.tsx');
    expect(src.includes('pm-sort-dir'),
      'PadPage no longer renders the .pm-sort-dir direction toggle').toBe(true);
    expect(src.includes("ascending: e.target.value === 'padName'"),
      'PadPage still hardcodes ascending direction in onChange').toBe(false);
  });

  it('UpdatePage referenced keys exist in en.json', () => {
    const en = JSON.parse(read('src/locales/en.json')) as Record<string, string>;
    // Keys added in this PR — guard against accidental rename/typo.
    for (const k of [
      'admin.loading', 'admin.toggle_sidebar', 'admin.shout',
      'admin_login.failed', 'admin_login.username', 'admin_login.password',
      'admin_login.submit', 'admin_login.title',
      'admin_pads.subtitle', 'admin_pads.refresh', 'admin_pads.cancel',
      'admin_pads.relative.just_now',
      'admin_pads.relative.minutes', 'admin_pads.relative.years',
      'admin_pads.filter.all', 'admin_pads.filter.active',
      'admin_pads.filter.recent', 'admin_pads.filter.empty',
      'admin_pads.filter.stale',
      'admin_plugins.subtitle', 'admin_plugins.reload_catalog',
      'admin_plugins.search_npm', 'admin_plugins.updates_available',
      'admin_plugins.update_tooltip',
      'admin_plugins.sort_ascending', 'admin_plugins.sort_descending',
      'admin_plugins.error_retrieving',
      'admin_plugins_info.subtitle', 'admin_plugins_info.copy_diagnostics',
      'admin_plugins_info.up_to_date', 'admin_plugins_info.update_available',
      'admin_plugins_info.git_sha', 'admin_plugins_info.no_hooks',
      'admin_plugins_info.tab_server', 'admin_plugins_info.tab_client',
      'admin_settings.saved_success', 'admin_settings.save_error',
      'admin_settings.create_pad', 'admin_settings.invalid_json',
      'update.page.disabled', 'update.page.unauthorized', 'update.page.error',
    ]) {
      expect(en[k], `Missing en.json key: ${k}`).toBeDefined();
    }
  });
});
