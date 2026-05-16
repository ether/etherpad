# Plugin frontend tests

Etherpad core's Playwright runner discovers plugin frontend specs from
the conventional path:

```
node_modules/ep_<plugin>/static/tests/frontend-new/specs/**/*.spec.ts
```

When the plugin is installed alongside core (e.g. via `pnpm add -w
ep_<plugin>` or in a `with-plugins` CI variant), the plugin's specs
run as part of `pnpm run test-ui`. Same pattern backend tests already
use (`mocha ... ../node_modules/ep_*/static/tests/backend/specs/**`).

This re-enables coverage that was lost in commit `cc80db2d3` (2023-07)
when the legacy jQuery test runner (`static/tests/frontend/specs/test.js`
+ in-page mocha+helper) was removed without a Playwright replacement.
See [#7622](https://github.com/ether/etherpad/issues/7622).

## Layout in your plugin

```
ep_yourplugin/
├── ep.json
├── package.json
├── static/
│   └── tests/
│       └── frontend-new/
│           └── specs/
│               └── yourplugin.spec.ts
└── ...
```

A spec is a normal Playwright test file. Import shared helpers from the
core package — `ep_etherpad-lite` is symlinked into `node_modules` by
the workspace, so this resolves anywhere the plugin is installed
alongside core:

```ts
import {expect, test} from '@playwright/test';
import {clearPadContent, getPadBody, goToNewPad, writeToPad}
    from 'ep_etherpad-lite/tests/frontend-new/helper/padHelper';

test.beforeEach(async ({page}) => {
  await goToNewPad(page);
});

test.describe('ep_yourplugin', () => {
  test('does the thing', async ({page}) => {
    const padBody = await getPadBody(page);
    await padBody.click();
    await clearPadContent(page);
    await writeToPad(page, 'hello');
    // …assertions…
    await expect(padBody.locator('div').first()).toHaveText('hello');
  });
});
```

## Migrating from the legacy `static/tests/frontend/specs/test.js`

The old format used mocha + a jQuery `helper` global:

```js
// Legacy — does not run anywhere any more.
describe('ep_yourplugin', function () {
  beforeEach(function (cb) { helper.newPad(cb); });
  it('does the thing', async function () {
    const chrome$ = helper.padChrome$;
    const inner$ = helper.padInner$;
    expect(chrome$('#yourbutton').length).to.be.greaterThan(0);
  });
});
```

Translation table:

| Legacy (mocha + helper) | Playwright |
|---|---|
| `describe(...)` / `it(...)` | `test.describe(...)` / `test(...)` |
| `helper.newPad(cb)` | `await goToNewPad(page)` |
| `helper.padChrome$('#x')` | `page.locator('#x')` |
| `helper.padInner$('div')` | `(await getPadBody(page)).locator('div')` |
| `expect(x).to.equal(y)` | `expect(x).toBe(y)` (Playwright's expect) |
| `expect($el.length).to.be.greaterThan(0)` | `await expect(page.locator('#x')).toBeVisible()` |
| `$el.sendkeys('text')` | `await page.keyboard.type('text')` |
| `$el.simulate('click')` | `await page.locator(...).click()` |

Most legacy specs translate ~mechanically. After migrating, **delete
the legacy file** so the plugin can't accidentally ship stale tests
that nothing executes.

## Running them

```sh
# Inside core, with the plugin installed:
pnpm run test-ui --project=chromium
# Or via core's with-plugins CI job (see frontend-tests.yml).
```

`pnpm run test-ui` automatically picks up plugin specs from any
installed `ep_*` package. To gate per-plugin: use playwright's
`--grep` against your plugin's describe name.
