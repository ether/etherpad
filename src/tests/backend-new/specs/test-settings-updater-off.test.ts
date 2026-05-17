'use strict';

// Source-level pin for src/tests/settings.json having `updates.tier: "off"`.
//
// Why this exists (#7800):
//   v2.7.x introduced the pad version-badge — an absolutely-positioned banner
//   at bottom-right (z-index 9999) that renders when /api/version-status
//   reports the running core is at least one major behind the latest GitHub
//   release. It intercepts pointer events on #chaticon (same corner,
//   z-index 400). Every Playwright spec that clicks the chat icon then
//   times out.
//
//   With `updates.tier: "off"`, `expressCreateServer` in
//   node/hooks/express/updateStatus.ts short-circuits and never registers
//   /api/version-status — the client fetch 404s and the badge stays hidden.
//
//   This setting is easy to silently revert during a settings reshuffle.
//   The lint here is cheap insurance: keep the default at "off" so any
//   downstream plugin that does `cp src/tests/settings.json settings.json`
//   against this core gets the fix for free.
//
// If you genuinely need the updater on for a specific test scenario, set
// it in that test's local fixture — don't change the shared default.

import {readFileSync} from 'fs';
import {join} from 'path';
import {describe, it, expect} from 'vitest';

const repoRoot = join(__dirname, '..', '..', '..', '..');
const read = (rel: string) => readFileSync(join(repoRoot, rel), 'utf8');

describe('test-settings updater default (#7800)', () => {
  it('src/tests/settings.json sets updates.tier="off"', () => {
    const json = JSON.parse(read('src/tests/settings.json'));
    expect(json.updates, 'updates block must be present').toBeDefined();
    expect(json.updates.tier).toBe('off');
  });
});
