'use strict';

// Regression for issue #7996: when `suppressPadDeletionTokenModal` hides the
// one-time "save your token" modal, the creator must still be able to retrieve
// the token this session holds. The server only ever sends the plaintext once
// and stores a hash, so without an on-demand reveal a creator who did not
// capture the token on arrival could never use token-based deletion from
// another device. These assertions guard the two halves of that path: the
// settings-panel control and the client wiring that fills it.

import {readFileSync} from 'fs';
import {join} from 'path';
import {describe, it, expect} from 'vitest';

const repoRoot = join(__dirname, '..', '..', '..', '..');
const read = (rel: string) => readFileSync(join(repoRoot, rel), 'utf8');

describe('pad deletion token reveal', () => {
  it('pad settings expose a hidden reveal control', () => {
    const html = read('src/templates/pad.html');
    expect(html.includes('id="delete-pad-token-reveal"'),
      'pad.html is missing the #delete-pad-token-reveal disclosure').toBe(true);
    expect(html.includes('id="delete-pad-token-reveal-value"'),
      'the reveal disclosure has no value input to fill').toBe(true);
    expect(html.includes('id="delete-pad-token-reveal-copy"'),
      'the reveal disclosure has no copy button').toBe(true);
    // The control is opt-in per session: it must start hidden so a suppressed
    // token is not shown to sessions that never received one.
    const disclosure = html.slice(html.indexOf('id="delete-pad-token-reveal"'));
    expect(disclosure.slice(0, disclosure.indexOf('>')).includes('hidden'),
      'the reveal disclosure must be hidden by default').toBe(true);
  });

  it('pad.ts routes a suppressed token to the settings reveal', () => {
    const ts = read('src/static/js/pad.ts');
    expect(ts.includes('revealDeletionTokenInSettings'),
      'pad.ts no longer routes suppressed tokens to the settings reveal').toBe(true);
    // The suppressed branch must return after handing the token over, so the
    // interrupting modal is still never shown.
    const suppressed = ts.indexOf('suppressPadDeletionTokenModal) {');
    expect(suppressed !== -1, 'the suppressed branch is missing').toBe(true);
    expect(ts.slice(suppressed, suppressed + 120).includes('return'),
      'the suppressed branch must return so the modal is not shown').toBe(true);
  });
});
