// Regression test for html10n's aria-label auto-population on form
// controls (<select>, <input>, <textarea>) — these have child <option>s
// or implicit value content, so the textContent branch in translateNode
// applies, and the aria-label population that lives in the no-children
// branch was being skipped. This left plugins like ep_font_size and
// ep_headings2 with a <select data-l10n-id="..."> but no accessible
// name once a hardcoded English aria-label was removed.
//
// See ether/etherpad PR that added this behavior (linked from
// ether/ep_align#182 review).

import {expect, test} from '@playwright/test';
import {goToNewPad} from '../helper/padHelper.js';

test.use({locale: 'en-US'});

test.beforeEach(async ({page}) => {
  await goToNewPad(page);
});

test('html10n auto-populates aria-label on <select> with data-l10n-id', async ({page}) => {
  // Inject a <select> with options into the toolbar, tagged with an
  // existing translation key (`pad.toolbar.bold.title` is shipped in
  // every locale).
  await page.evaluate(() => {
    const sel = document.createElement('select');
    sel.id = 'html10n-test-select';
    sel.setAttribute('data-l10n-id', 'pad.toolbar.bold.title');
    const opt = document.createElement('option');
    opt.value = 'a';
    opt.textContent = 'A';
    sel.appendChild(opt);
    document.body.appendChild(sel);
    // Trigger a re-translate so html10n sees the new node.
    // @ts-ignore window.html10n is exposed by pad.ts
    window.html10n.localize(['en']);
  });

  const sel = page.locator('#html10n-test-select');
  // After translation, aria-label should be set from the localized
  // string, and the data-l10n-aria-label marker should signal that
  // html10n owns it (so applyLanguage refreshes it on language change).
  await expect(sel).toHaveAttribute('aria-label', /.+/);
  await expect(sel).toHaveAttribute('data-l10n-aria-label', 'true');
});

test('html10n auto-populates aria-label on <textarea> with data-l10n-id', async ({page}) => {
  await page.evaluate(() => {
    const ta = document.createElement('textarea');
    ta.id = 'html10n-test-textarea';
    ta.setAttribute('data-l10n-id', 'pad.toolbar.bold.title');
    document.body.appendChild(ta);
    // @ts-ignore
    window.html10n.localize(['en']);
  });

  const ta = page.locator('#html10n-test-textarea');
  await expect(ta).toHaveAttribute('aria-label', /.+/);
  await expect(ta).toHaveAttribute('data-l10n-aria-label', 'true');
});

test('no "could not translate element content" warning for <select data-l10n-id>', async ({page}) => {
  // Regression: thm reported the warning on Etherpad 3.1.0 because the
  // <select data-l10n-id="ep_headings.style"> in ep_headings2 has only
  // <option> element children — the text-node hunt in translateNode finds
  // nothing and used to warn before the SELECT/INPUT/TEXTAREA short-circuit
  // landed. The accessible name still ends up on aria-label.
  //
  // To actually exercise the bug path the key must default `prop` to
  // textContent (i.e. the suffix after the last `.` must NOT be one of
  // title|innerHTML|alt|textContent|value|placeholder, see
  // html10n.translateNode). `pad.loading` is a stable pad-bundle key that
  // satisfies that.
  const warnings: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'warning') warnings.push(msg.text());
  });

  await page.evaluate(() => new Promise<void>((res) => {
    const sel = document.createElement('select');
    sel.id = 'html10n-test-no-warn';
    sel.setAttribute('data-l10n-id', 'pad.loading');
    for (const v of ['a', 'b', 'c']) {
      const opt = document.createElement('option');
      opt.value = v;
      opt.textContent = v.toUpperCase();
      sel.appendChild(opt);
    }
    document.body.appendChild(sel);
    // localize completes asynchronously inside a build() callback; wait
    // on the `localized` event instead of a fixed timeout so the test
    // is deterministic on slow CI runners.
    // @ts-ignore window.html10n is exposed by pad.ts
    window.html10n.mt.bind('localized', () => res());
    // @ts-ignore
    window.html10n.localize(['en']);
  }));

  const offending = warnings.filter((m) =>
      m.includes('could not translate element content') &&
      m.includes('pad.loading'));
  expect(offending).toEqual([]);
});

test('an author-supplied aria-label on a form control is preserved', async ({page}) => {
  // Mirror the existing semantics for non-form-control elements: if the
  // template author wrote their own aria-label, html10n must not
  // overwrite it on the first pass (it can only refresh values it
  // previously wrote, identified by the data-l10n-aria-label marker).
  await page.evaluate(() => {
    const sel = document.createElement('select');
    sel.id = 'html10n-test-author-aria';
    sel.setAttribute('data-l10n-id', 'pad.toolbar.bold.title');
    sel.setAttribute('aria-label', 'Custom author label');
    const opt = document.createElement('option');
    opt.value = 'a';
    opt.textContent = 'A';
    sel.appendChild(opt);
    document.body.appendChild(sel);
    // @ts-ignore
    window.html10n.localize(['en']);
  });

  const sel = page.locator('#html10n-test-author-aria');
  await expect(sel).toHaveAttribute('aria-label', 'Custom author label');
  // No marker is set — html10n didn't write this one.
  await expect(sel).not.toHaveAttribute('data-l10n-aria-label', 'true');
});
