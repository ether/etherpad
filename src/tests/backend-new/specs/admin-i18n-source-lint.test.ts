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

  it('UpdatePage referenced keys exist in en.json', () => {
    const en = JSON.parse(read('src/locales/en.json')) as Record<string, string>;
    // Keys added in this PR — guard against accidental rename/typo.
    for (const k of [
      'admin.loading', 'admin.toggle_sidebar', 'admin.shout',
      'admin_login.failed', 'admin_login.username', 'admin_login.password',
      'admin_login.submit', 'admin_login.title',
      'admin_pads.subtitle', 'admin_pads.refresh', 'admin_pads.cancel',
      'admin_pads.empty_state', 'admin_pads.relative.just_now',
      'admin_pads.relative.minutes', 'admin_pads.relative.years',
      'admin_pads.filter.all', 'admin_pads.filter.active',
      'admin_pads.filter.recent', 'admin_pads.filter.empty',
      'admin_pads.filter.stale',
      'admin_plugins.subtitle', 'admin_plugins.reload_catalog',
      'admin_plugins.search_npm', 'admin_plugins.updates_available',
      'admin_plugins.popular_tag', 'admin_plugins.update_tooltip',
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
