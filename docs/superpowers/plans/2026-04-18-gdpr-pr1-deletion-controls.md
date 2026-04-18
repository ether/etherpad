# GDPR PR1 — Pad Deletion Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the first of five GDPR PRs from ether/etherpad#6701 — adds a one-time deletion token, an `allowPadDeletionByAllUsers` admin flag, and the UI + endpoint plumbing needed for creators to delete a pad without their browser cookies.

**Architecture:** A new `PadDeletionManager` module owns the token (sha256-hashed in the db under `pad:<id>:deletionToken`, returned plaintext exactly once on creation). `handlePadDelete` gains a three-way authorisation check — creator cookie → valid token → settings flag — and `createPad`/`createGroupPad` return the token in the HTTP API response. The browser creator also receives the token via `clientVars.padDeletionToken`, shows it in a one-time modal, and gets a "delete with token" field in the settings popup for devices without the creator cookie.

**Tech Stack:** TypeScript (etherpad server + client), jQuery + EJS for pad UI, Playwright for frontend tests, Mocha + supertest for backend tests.

---

## File Structure

**Already in working tree (from restored stash):**
- `src/node/db/PadDeletionManager.ts` — create / verify (timing-safe) / remove
- `settings.json.template`, `settings.json.docker` — `allowPadDeletionByAllUsers: false`
- `src/node/utils/Settings.ts` — `allowPadDeletionByAllUsers` type + default
- `src/node/db/API.ts` — `createPad` returns `{deletionToken}`
- `src/node/db/GroupManager.ts` — `createGroupPad` returns `{padID, deletionToken}`
- `src/node/db/Pad.ts` — `Pad.remove()` calls `removeDeletionToken`
- `src/static/js/types/SocketIOMessage.ts` — `ClientVarPayload` has optional `padDeletionToken`

**Created by this plan:**
- `src/tests/backend/specs/padDeletionManager.ts` — unit tests for the manager
- `src/tests/backend/specs/api/deletePad.ts` — authorisation-matrix tests
- `src/tests/frontend-new/specs/pad_deletion_token.spec.ts` — end-to-end modal + delete-by-token

**Modified by this plan:**
- `src/node/handler/PadMessageHandler.ts` — three-way auth in `handlePadDelete`; thread `padDeletionToken` into `clientVars` for creator sessions
- `src/node/db/API.ts` — expose the optional `deletionToken` parameter on the programmatic `deletePad(padID, deletionToken?)` path for REST coverage
- `src/static/js/types/SocketIOMessage.ts` — add optional `deletionToken` to `PadDeleteMessage`
- `src/templates/pad.html` — post-creation token modal, delete-by-token disclosure under Delete button
- `src/static/js/pad.ts` — surface modal when `clientVars.padDeletionToken` is present, clear it after ack
- `src/static/js/pad_editor.ts` — wire delete-by-token input into the existing delete flow
- `src/static/css/pad.css` (or the skin component file the Delete button already lives in) — minimal styling for modal + disclosure
- `src/locales/en.json` — new localisation keys
- `src/tests/backend/specs/api/api.ts` — extend to cover `createPad` returning a token once

---

## Task 1: Baseline and verify the restored scaffolding

**Files:**
- (no edits — validation only)

- [ ] **Step 1: Confirm branch and stashed files exist**

```bash
git status --short
git log --oneline -5
```

Expected: current branch is `feat-gdpr-pad-deletion`, HEAD shows `docs: PR1 GDPR deletion-controls design spec`, and working tree modifications cover `settings.json.template`, `settings.json.docker`, `src/node/db/API.ts`, `src/node/db/GroupManager.ts`, `src/node/db/Pad.ts`, `src/node/utils/Settings.ts`, `src/static/js/types/SocketIOMessage.ts`, plus the untracked `src/node/db/PadDeletionManager.ts`.

- [ ] **Step 2: Type check before touching anything**

Run: `pnpm --filter ep_etherpad-lite run ts-check`
Expected: exit 0, no TypeScript errors.

- [ ] **Step 3: Commit the restored scaffolding as its own change**

```bash
git add settings.json.template settings.json.docker \
        src/node/db/API.ts src/node/db/GroupManager.ts src/node/db/Pad.ts \
        src/node/utils/Settings.ts src/static/js/types/SocketIOMessage.ts \
        src/node/db/PadDeletionManager.ts
git commit -m "$(cat <<'EOF'
feat(gdpr): scaffolding for pad deletion tokens

PadDeletionManager stores a sha256-hashed per-pad deletion token and
verifies it with timing-safe comparison. createPad / createGroupPad
return the plaintext token once on first creation, and Pad.remove()
cleans it up. Gated behind the new allowPadDeletionByAllUsers flag
which defaults to false to preserve existing behaviour.

Part of #6701 (GDPR PR1).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected: clean commit, no pre-commit hook failures.

---

## Task 2: Unit tests for `PadDeletionManager`

**Files:**
- Create: `src/tests/backend/specs/padDeletionManager.ts`

- [ ] **Step 1: Write the failing test file**

```typescript
'use strict';

import {strict as assert} from 'assert';

const common = require('../common');
const padDeletionManager = require('../../../node/db/PadDeletionManager');

describe(__filename, function () {
  before(async function () { await common.init(); });

  const uniqueId = () => `pdmtest_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

  describe('createDeletionTokenIfAbsent', function () {
    it('returns a non-empty string on first call', async function () {
      const padId = uniqueId();
      const token = await padDeletionManager.createDeletionTokenIfAbsent(padId);
      assert.equal(typeof token, 'string');
      assert.ok(token.length >= 32);
      await padDeletionManager.removeDeletionToken(padId);
    });

    it('returns null on subsequent calls for the same pad', async function () {
      const padId = uniqueId();
      const first = await padDeletionManager.createDeletionTokenIfAbsent(padId);
      const second = await padDeletionManager.createDeletionTokenIfAbsent(padId);
      assert.equal(typeof first, 'string');
      assert.equal(second, null);
      await padDeletionManager.removeDeletionToken(padId);
    });

    it('emits different tokens for different pads', async function () {
      const a = uniqueId();
      const b = uniqueId();
      const tokenA = await padDeletionManager.createDeletionTokenIfAbsent(a);
      const tokenB = await padDeletionManager.createDeletionTokenIfAbsent(b);
      assert.notEqual(tokenA, tokenB);
      await padDeletionManager.removeDeletionToken(a);
      await padDeletionManager.removeDeletionToken(b);
    });
  });

  describe('isValidDeletionToken', function () {
    it('accepts the token returned by the matching pad', async function () {
      const padId = uniqueId();
      const token = await padDeletionManager.createDeletionTokenIfAbsent(padId);
      assert.equal(await padDeletionManager.isValidDeletionToken(padId, token), true);
      await padDeletionManager.removeDeletionToken(padId);
    });

    it('rejects a token for the wrong pad', async function () {
      const a = uniqueId();
      const b = uniqueId();
      const tokenA = await padDeletionManager.createDeletionTokenIfAbsent(a);
      await padDeletionManager.createDeletionTokenIfAbsent(b);
      assert.equal(await padDeletionManager.isValidDeletionToken(b, tokenA), false);
      await padDeletionManager.removeDeletionToken(a);
      await padDeletionManager.removeDeletionToken(b);
    });

    it('rejects a non-string token', async function () {
      const padId = uniqueId();
      await padDeletionManager.createDeletionTokenIfAbsent(padId);
      assert.equal(await padDeletionManager.isValidDeletionToken(padId, null), false);
      assert.equal(await padDeletionManager.isValidDeletionToken(padId, undefined), false);
      assert.equal(await padDeletionManager.isValidDeletionToken(padId, ''), false);
      await padDeletionManager.removeDeletionToken(padId);
    });

    it('returns false for pads that never had a token', async function () {
      const padId = uniqueId();
      assert.equal(await padDeletionManager.isValidDeletionToken(padId, 'anything'), false);
    });
  });

  describe('removeDeletionToken', function () {
    it('invalidates the stored token', async function () {
      const padId = uniqueId();
      const token = await padDeletionManager.createDeletionTokenIfAbsent(padId);
      await padDeletionManager.removeDeletionToken(padId);
      assert.equal(await padDeletionManager.isValidDeletionToken(padId, token), false);
    });

    it('is safe to call when no token exists', async function () {
      const padId = uniqueId();
      await padDeletionManager.removeDeletionToken(padId); // must not throw
    });
  });
});
```

- [ ] **Step 2: Run the test file and confirm it passes**

Run: `pnpm --filter ep_etherpad-lite exec mocha --require tsx/cjs tests/backend/specs/padDeletionManager.ts --timeout 10000`
Expected: all 8 tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/tests/backend/specs/padDeletionManager.ts
git commit -m "test(gdpr): PadDeletionManager unit tests"
```

---

## Task 3: Extend `PadDeleteMessage` type and `handlePadDelete` authorisation

**Files:**
- Modify: `src/static/js/types/SocketIOMessage.ts:198-203`
- Modify: `src/node/handler/PadMessageHandler.ts:230-265`

- [ ] **Step 1: Add `deletionToken` to `PadDeleteMessage`**

```typescript
// src/static/js/types/SocketIOMessage.ts
export type PadDeleteMessage = {
  type: 'PAD_DELETE'
  data: {
    padId: string
    deletionToken?: string
  }
}
```

- [ ] **Step 2: Thread the token through `handlePadDelete`**

Open `src/node/handler/PadMessageHandler.ts`, find `handlePadDelete` (near line 230), and replace its body (keep the outer async function signature) with:

```typescript
const handlePadDelete = async (socket: any, padDeleteMessage: PadDeleteMessage) => {
  const session = sessioninfos[socket.id];
  if (!session || !session.author || !session.padId) throw new Error('session not ready');
  const padId = padDeleteMessage.data.padId;
  if (session.padId !== padId) throw new Error('refusing cross-pad delete');
  if (!await padManager.doesPadExist(padId)) return;

  const retrievedPad = await padManager.getPad(padId);
  const firstContributor = await retrievedPad.getRevisionAuthor(0);
  const isCreator = session.author === firstContributor;
  const tokenOk = !isCreator && await padDeletionManager.isValidDeletionToken(
      padId, padDeleteMessage.data.deletionToken);
  const flagOk = !isCreator && !tokenOk && settings.allowPadDeletionByAllUsers;

  if (isCreator || tokenOk || flagOk) {
    await retrievedPad.remove();
    return;
  }

  socket.emit('shout', {
    type: 'COLLABROOM',
    data: {
      type: 'shoutMessage',
      payload: {
        message: {
          message: 'You are not the creator of this pad, so you cannot delete it',
          sticky: false,
        },
        timestamp: Date.now(),
      },
    },
  });
};
```

- [ ] **Step 3: Wire the new imports at the top of `PadMessageHandler.ts`**

Ensure the file has:

```typescript
const padDeletionManager = require('../db/PadDeletionManager');
```

(Add it to the import block alongside the existing `padManager` require. If it is already present from earlier scaffolding, skip this step.)

- [ ] **Step 4: Type check**

Run: `pnpm --filter ep_etherpad-lite run ts-check`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/static/js/types/SocketIOMessage.ts src/node/handler/PadMessageHandler.ts
git commit -m "feat(gdpr): three-way auth for socket PAD_DELETE

Creator cookie → valid deletion token → allowPadDeletionByAllUsers flag.
Anyone else still gets the existing refusal shout."
```

---

## Task 4: Programmatic `deletePad(padId, deletionToken?)` and REST coverage

**Files:**
- Modify: `src/node/db/API.ts:530-545` (the `deletePad` export)

- [ ] **Step 1: Extend the programmatic `deletePad` signature**

Replace the existing `exports.deletePad` with:

```typescript
/**
deletePad(padID, deletionToken?) deletes a pad
...
 */
exports.deletePad = async (padID: string, deletionToken?: string) => {
  const pad = await getPadSafe(padID, true);
  // apikey-authenticated callers bypass token checks — they're already trusted.
  // For anonymous callers that hit this code path (e.g. a future public endpoint),
  // require a valid token unless the instance has opted everyone in.
  if (deletionToken !== undefined &&
      !settings.allowPadDeletionByAllUsers &&
      !await padDeletionManager.isValidDeletionToken(padID, deletionToken)) {
    throw new CustomError('invalid deletionToken', 'apierror');
  }
  await pad.remove();
};
```

- [ ] **Step 2: Add the `CustomError` and `settings` imports if missing**

At the top of `src/node/db/API.ts`, confirm the file has:

```typescript
const CustomError = require('../utils/customError');
import settings from '../utils/Settings';
```

(Both already exist in etherpad; add only if absent.)

- [ ] **Step 3: Type check**

Run: `pnpm --filter ep_etherpad-lite run ts-check`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/node/db/API.ts
git commit -m "feat(gdpr): optional deletionToken on programmatic deletePad"
```

---

## Task 5: Advertise `deletionToken` in the REST OpenAPI schema

**Files:**
- Modify: `src/node/handler/APIHandler.ts` — add `deletionToken` to the `deletePad` arg list

- [ ] **Step 1: Extend the API version-map entry for `deletePad`**

Open `src/node/handler/APIHandler.ts` and locate the existing `deletePad: ['padID']` entry (around line 56). Change it to:

```typescript
deletePad: ['padID', 'deletionToken'],
```

If the codebase uses a per-version map (older vs. newer), make the same change in every version entry that currently lists `deletePad`.

- [ ] **Step 2: Type check**

Run: `pnpm --filter ep_etherpad-lite run ts-check`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/node/handler/APIHandler.ts
git commit -m "feat(gdpr): advertise optional deletionToken on REST deletePad"
```

---

## Task 6: REST API test for the authorisation matrix

**Files:**
- Create: `src/tests/backend/specs/api/deletePad.ts`

- [ ] **Step 1: Write the test spec**

```typescript
'use strict';

import {strict as assert} from 'assert';

const common = require('../../common');
import settings from '../../../node/utils/Settings';

let agent: any;
let apiKey: string;

const makeId = () => `gdprdel_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const apiCall = async (point: string, query: Record<string, string>) => {
  const params = new URLSearchParams({apikey: apiKey, ...query}).toString();
  return await agent.get(`/api/1/${point}?${params}`);
};

describe(__filename, function () {
  before(async function () {
    agent = await common.init();
    apiKey = common.apiKey;
  });

  afterEach(function () { settings.allowPadDeletionByAllUsers = false; });

  it('createPad returns a plaintext deletionToken the first time', async function () {
    const padId = makeId();
    const res = await apiCall('createPad', {padID: padId});
    assert.equal(res.body.code, 0);
    assert.equal(typeof res.body.data.deletionToken, 'string');
    assert.ok(res.body.data.deletionToken.length >= 32);
    await apiCall('deletePad', {padID: padId, deletionToken: res.body.data.deletionToken});
  });

  it('deletePad with a valid deletionToken succeeds', async function () {
    const padId = makeId();
    const create = await apiCall('createPad', {padID: padId});
    const token = create.body.data.deletionToken;
    const del = await apiCall('deletePad', {padID: padId, deletionToken: token});
    assert.equal(del.body.code, 0, JSON.stringify(del.body));
    const check = await apiCall('getText', {padID: padId});
    assert.equal(check.body.code, 1); // "padID does not exist"
  });

  it('deletePad with a wrong deletionToken is refused', async function () {
    const padId = makeId();
    await apiCall('createPad', {padID: padId});
    const del = await apiCall('deletePad', {padID: padId, deletionToken: 'not-the-real-token'});
    assert.equal(del.body.code, 1);
    assert.match(del.body.message, /invalid deletionToken/);
    // cleanup — apikey-authenticated caller is trusted when no token is supplied
    await apiCall('deletePad', {padID: padId});
  });

  it('deletePad with allowPadDeletionByAllUsers=true bypasses the token check', async function () {
    const padId = makeId();
    await apiCall('createPad', {padID: padId});
    settings.allowPadDeletionByAllUsers = true;
    const del = await apiCall('deletePad', {padID: padId, deletionToken: 'bogus'});
    assert.equal(del.body.code, 0);
  });

  it('apikey-only call (no deletionToken) still works — admins stay trusted', async function () {
    const padId = makeId();
    await apiCall('createPad', {padID: padId});
    const del = await apiCall('deletePad', {padID: padId});
    assert.equal(del.body.code, 0);
  });
});
```

- [ ] **Step 2: Run the new spec**

Run: `pnpm --filter ep_etherpad-lite exec mocha --require tsx/cjs tests/backend/specs/api/deletePad.ts --timeout 20000`
Expected: all 5 tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/tests/backend/specs/api/deletePad.ts
git commit -m "test(gdpr): cover deletePad authorisation matrix via REST"
```

---

## Task 7: Send `padDeletionToken` to the creator session via `clientVars`

**Files:**
- Modify: `src/node/handler/PadMessageHandler.ts` — in the CLIENT_READY handler where `clientVars` is assembled (around line 1008)

- [ ] **Step 1: Compute the token in the same block that decides creator-only UI**

Locate the `const canEditPadSettings = ...` computation introduced by PR #7545 (or its nearest equivalent — the creator-cookie check using `isPadCreator`). Immediately after it, add:

```typescript
const padDeletionToken = !sessionInfo.readonly && canEditPadSettings
    ? await padDeletionManager.createDeletionTokenIfAbsent(sessionInfo.padId)
    : null;
```

Then include the field in the `clientVars` literal (right after `canEditPadSettings`):

```typescript
      padDeletionToken,
```

(If PR #7545 has not merged yet on this branch, replace `canEditPadSettings` in the conditional with the equivalent inline expression:
`!sessionInfo.readonly && await isPadCreator(pad, sessionInfo.author)`.)

- [ ] **Step 2: Confirm the `ClientVarPayload` type already has `padDeletionToken`**

`src/static/js/types/SocketIOMessage.ts` should still contain:

```typescript
  padDeletionToken?: string | null,
```

(added by the restored scaffolding). If it was stripped during earlier cleanup, add it back.

- [ ] **Step 3: Type check**

Run: `pnpm --filter ep_etherpad-lite run ts-check`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/node/handler/PadMessageHandler.ts src/static/js/types/SocketIOMessage.ts
git commit -m "feat(gdpr): surface padDeletionToken in clientVars for creators only"
```

---

## Task 8: Locale strings

**Files:**
- Modify: `src/locales/en.json`

- [ ] **Step 1: Add the new keys**

Insert the following inside the `pad.*` block (next to `pad.delete.confirm`):

```json
  "pad.deletionToken.modalTitle": "Save your pad deletion token",
  "pad.deletionToken.modalBody": "This token is the only way to delete this pad if you lose your browser session or switch device. Save it somewhere safe — it is shown here exactly once.",
  "pad.deletionToken.copy": "Copy",
  "pad.deletionToken.copied": "Copied",
  "pad.deletionToken.acknowledge": "I've saved it",
  "pad.deletionToken.deleteWithToken": "Delete with token",
  "pad.deletionToken.tokenFieldLabel": "Pad deletion token",
  "pad.deletionToken.invalid": "That token is not valid for this pad.",
```

Leave every other locale file untouched — English is the canonical source; translators fill in the rest.

- [ ] **Step 2: Type check (picks up JSON parse errors via test-runner bootstrap)**

Run: `pnpm --filter ep_etherpad-lite run ts-check`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/locales/en.json
git commit -m "i18n(gdpr): strings for deletion-token modal and delete-with-token flow"
```

---

## Task 9: Template — one-time token modal + delete-by-token disclosure

**Files:**
- Modify: `src/templates/pad.html`

- [ ] **Step 1: Add the deletion-token modal, sibling to the existing `#settings` popup**

Find the `<div id="settings" class="popup">...</div>` block. Immediately after its closing wrapper, add:

```html
      <div id="deletiontoken-modal" class="popup" hidden>
        <div class="popup-content">
          <h1 data-l10n-id="pad.deletionToken.modalTitle">Save your pad deletion token</h1>
          <p data-l10n-id="pad.deletionToken.modalBody">
            This token is the only way to delete this pad if you lose your
            browser session or switch device. Save it somewhere safe — it
            is shown here exactly once.
          </p>
          <div class="deletiontoken-row">
            <input type="text" id="deletiontoken-value" readonly>
            <button id="deletiontoken-copy" type="button" data-l10n-id="pad.deletionToken.copy">Copy</button>
          </div>
          <button id="deletiontoken-ack" type="button" class="btn btn-primary"
                  data-l10n-id="pad.deletionToken.acknowledge">I've saved it</button>
        </div>
      </div>
```

- [ ] **Step 2: Add the delete-by-token disclosure under the existing Delete button**

Find `<button data-l10n-id="pad.settings.deletePad" id="delete-pad">Delete pad</button>` in the settings popup. Replace the single button with:

```html
              <button data-l10n-id="pad.settings.deletePad" id="delete-pad">Delete pad</button>
              <details id="delete-pad-with-token">
                <summary data-l10n-id="pad.deletionToken.deleteWithToken">Delete with token</summary>
                <label for="delete-pad-token-input" data-l10n-id="pad.deletionToken.tokenFieldLabel">Pad deletion token</label>
                <input type="password" id="delete-pad-token-input" autocomplete="off" spellcheck="false">
                <button id="delete-pad-token-submit" type="button" class="btn btn-danger"
                        data-l10n-id="pad.settings.deletePad">Delete pad</button>
              </details>
```

- [ ] **Step 3: Commit**

```bash
git add src/templates/pad.html
git commit -m "feat(gdpr): token modal + delete-with-token disclosure markup"
```

---

## Task 10: Client JS — modal reveal and delete-by-token wiring

**Files:**
- Modify: `src/static/js/pad.ts` — surface the modal, scrub token from `clientVars`
- Modify: `src/static/js/pad_editor.ts` — delete-by-token submit

- [ ] **Step 1: Surface the modal and scrub the token after acknowledgement**

In `src/static/js/pad.ts`, locate the `init` / `handleInit` phase — immediately after `clientVars` has been applied and the pad is usable. Add the following helper and an invocation:

```typescript
const showDeletionTokenModalIfPresent = () => {
  const token = clientVars.padDeletionToken;
  if (!token) return;
  const $modal = $('#deletiontoken-modal');
  const $input = $('#deletiontoken-value');
  const $copy = $('#deletiontoken-copy');
  const $ack = $('#deletiontoken-ack');
  if ($modal.length === 0) return;

  $input.val(token);
  $modal.prop('hidden', false).addClass('popup-show');

  $copy.off('click.gdpr').on('click.gdpr', async () => {
    try {
      await navigator.clipboard.writeText(token);
      $copy.text(html10n.get('pad.deletionToken.copied'));
    } catch (e) {
      ($input[0] as HTMLInputElement).select();
      document.execCommand('copy');
      $copy.text(html10n.get('pad.deletionToken.copied'));
    }
  });

  $ack.off('click.gdpr').on('click.gdpr', () => {
    $input.val('');
    $modal.prop('hidden', true).removeClass('popup-show');
    (clientVars as any).padDeletionToken = null;
  });
};
```

Call `showDeletionTokenModalIfPresent()` once, after the user-visible pad has finished loading (a good spot is immediately after the existing `padeditor.init(...)` or `padimpexp.init(...)` call).

- [ ] **Step 2: Wire the delete-by-token UI**

In `src/static/js/pad_editor.ts`, find the existing `$('#delete-pad').on('click', ...)` handler (around line 90) and, directly after it, add:

```typescript
      // delete pad using a recovery token
      $('#delete-pad-token-submit').on('click', () => {
        const token = String($('#delete-pad-token-input').val() || '').trim();
        if (!token) return;
        if (!window.confirm(html10n.get('pad.delete.confirm'))) return;

        let handled = false;
        pad.socket.on('message', (data: any) => {
          if (data && data.disconnect === 'deleted') {
            handled = true;
            window.location.href = '/';
          }
        });
        pad.socket.on('shout', (data: any) => {
          handled = true;
          const msg = data?.data?.payload?.message?.message;
          if (msg) window.alert(msg);
        });
        pad.collabClient.sendMessage({
          type: 'PAD_DELETE',
          data: {padId: pad.getPadId(), deletionToken: token},
        });
        setTimeout(() => {
          if (!handled) window.location.href = '/';
        }, 5000);
      });
```

- [ ] **Step 3: Type check**

Run: `pnpm --filter ep_etherpad-lite run ts-check`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/static/js/pad.ts src/static/js/pad_editor.ts
git commit -m "feat(gdpr): show deletion token once, allow delete via recovery token"
```

---

## Task 11: Minimal styling for the modal + disclosure

**Files:**
- Modify: `src/static/css/pad.css` (or the skin CSS file that already styles `.popup`)

- [ ] **Step 1: Add scoped styles**

Append:

```css
#deletiontoken-modal .deletiontoken-row {
  display: flex;
  gap: 0.5rem;
  margin: 1rem 0;
}

#deletiontoken-modal #deletiontoken-value {
  flex: 1;
  font-family: monospace;
  padding: 0.4rem;
  user-select: all;
}

#delete-pad-with-token {
  margin-top: 0.5rem;
}

#delete-pad-with-token summary {
  cursor: pointer;
  color: var(--text-muted, #666);
  font-size: 0.9rem;
}

#delete-pad-with-token input {
  margin: 0.5rem 0;
  width: 100%;
  font-family: monospace;
}
```

Use whichever file the existing `#settings.popup` and `#delete-pad` styles live in (check via `grep -rn "#delete-pad" src/static/css src/static/skins` and pick the one already loaded by `pad.html`).

- [ ] **Step 2: Commit**

```bash
git add src/static/css/pad.css # or the skin file you actually touched
git commit -m "style(gdpr): modal + delete-with-token layout"
```

---

## Task 12: Frontend Playwright coverage

**Files:**
- Create: `src/tests/frontend-new/specs/pad_deletion_token.spec.ts`

- [ ] **Step 1: Write the Playwright spec**

```typescript
import {expect, test} from '@playwright/test';
import {goToNewPad, goToPad} from '../helper/padHelper';
import {showSettings} from '../helper/settingsHelper';

test.describe('pad deletion token', () => {
  test.beforeEach(async ({context}) => {
    await context.clearCookies();
  });

  test('creator sees a token modal exactly once and can dismiss it', async ({page}) => {
    await goToNewPad(page);
    const modal = page.locator('#deletiontoken-modal');
    await expect(modal).toBeVisible();

    const tokenValue = await page.locator('#deletiontoken-value').inputValue();
    expect(tokenValue.length).toBeGreaterThanOrEqual(32);

    await page.locator('#deletiontoken-ack').click();
    await expect(modal).toBeHidden();

    const cleared = await page.evaluate(
        () => (window as any).clientVars.padDeletionToken);
    expect(cleared == null).toBe(true);
  });

  test('second device can delete using the captured token', async ({page, browser}) => {
    const padId = await goToNewPad(page);
    const token = await page.locator('#deletiontoken-value').inputValue();
    await page.locator('#deletiontoken-ack').click();

    const context2 = await browser.newContext();
    const page2 = await context2.newPage();
    await goToPad(page2, padId);
    await showSettings(page2);

    await page2.locator('#delete-pad-with-token > summary').click();
    await page2.locator('#delete-pad-token-input').fill(token);
    page2.once('dialog', (d) => d.accept());
    await page2.locator('#delete-pad-token-submit').click();

    await expect(page2).toHaveURL(/\/$|\/index\.html$/, {timeout: 10000});

    // The pad should be gone — opening it again yields a fresh empty pad.
    await goToPad(page2, padId);
    const contents = await page2.frameLocator('iframe[name="ace_outer"]')
        .frameLocator('iframe[name="ace_inner"]').locator('#innerdocbody').textContent();
    expect((contents || '').trim().length).toBeLessThan(200); // default welcome text only

    await context2.close();
  });

  test('wrong token keeps the pad alive and surfaces a shout', async ({page, browser}) => {
    const padId = await goToNewPad(page);
    await page.locator('#deletiontoken-ack').click();

    const context2 = await browser.newContext();
    const page2 = await context2.newPage();
    await goToPad(page2, padId);
    await showSettings(page2);

    await page2.locator('#delete-pad-with-token > summary').click();
    await page2.locator('#delete-pad-token-input').fill('bogus-token-value');
    page2.once('dialog', (d) => d.accept());
    const alertPromise = page2.waitForEvent('dialog');
    await page2.locator('#delete-pad-token-submit').click();
    const alert = await alertPromise;
    expect(alert.message()).toMatch(/not the creator|cannot delete/);
    await alert.dismiss();

    // Pad must still exist for the original creator.
    await page.reload();
    await expect(page.locator('#editorcontainer.initialized')).toBeVisible();
    await context2.close();
  });
});
```

- [ ] **Step 2: Restart the test server so it picks up the current branch's code**

```bash
lsof -iTCP:9001 -sTCP:LISTEN 2>/dev/null | awk 'NR>1 {print $2}' | xargs -r kill 2>&1; sleep 2
(cd src && NODE_ENV=production node --require tsx/cjs node/server.ts -- \
    --settings tests/settings.json > /tmp/etherpad-test.log 2>&1 &)
sleep 8
lsof -iTCP:9001 -sTCP:LISTEN 2>/dev/null | tail -2
```

Expected: port 9001 is listening.

- [ ] **Step 3: Run the new Playwright spec**

```bash
cd src && NODE_ENV=production npx playwright test pad_deletion_token --project=chromium
```

Expected: 3 tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/tests/frontend-new/specs/pad_deletion_token.spec.ts
git commit -m "test(gdpr): Playwright coverage for deletion-token modal + delete-with-token"
```

---

## Task 13: End-to-end verification, push, open PR

**Files:** (no edits)

- [ ] **Step 1: Full type-check**

Run: `pnpm --filter ep_etherpad-lite run ts-check`
Expected: exit 0.

- [ ] **Step 2: Backend tests for just this feature**

```bash
pnpm --filter ep_etherpad-lite exec mocha --require tsx/cjs \
  tests/backend/specs/padDeletionManager.ts \
  tests/backend/specs/api/deletePad.ts --timeout 20000
```

Expected: 13 tests pass.

- [ ] **Step 3: Full Playwright smoke for the touched specs**

```bash
cd src && NODE_ENV=production npx playwright test \
  pad_deletion_token pad_settings --project=chromium
```

Expected: all tests pass. (pad_settings included because Task 7 changes the `clientVars` assembly near its creator-only code.)

- [ ] **Step 4: Push and open the PR**

```bash
git push origin feat-gdpr-pad-deletion
gh pr create --title "feat(gdpr): pad deletion controls (PR1 of #6701)" --body "$(cat <<'EOF'
## Summary
- One-time sha256-hashed deletion token, surfaced plaintext once on create
- allowPadDeletionByAllUsers flag (defaults to false) to widen deletion rights
- Three-way auth on socket PAD_DELETE and REST deletePad: creator cookie, valid token, or settings flag
- Browser creators see a one-time token modal and can later delete via a recovery-token field in the pad settings popup

First of the five GDPR PRs outlined in #6701. Remaining scope (IP audit, identity hardening, cookie banner, author erasure) stays in follow-ups.

## Test plan
- [ ] ts-check clean
- [ ] Backend: padDeletionManager + api/deletePad specs
- [ ] Frontend: pad_deletion_token.spec.ts and pad_settings.spec.ts regression
EOF
)"
```

Expected: PR opens, CI runs.

- [ ] **Step 5: Monitor CI**

Run: `sleep 25 && gh pr checks <PR-number>`
Expected: all checks green (or failure triage kicks in, per the feedback_check_ci_after_pr memory).

---

## Self-Review

**Spec coverage:**

| Spec section | Task(s) |
| --- | --- |
| Authorization matrix (creator / token / flag / other) | 3, 4, 6 |
| Token lifecycle (create-if-absent, hash, timing-safe, remove on pad delete) | 1 (scaffolding), 2 (unit tests) |
| Socket PAD_DELETE + REST deletePad endpoint changes | 3, 4, 5 |
| createPad / createGroupPad return `deletionToken` | 1 (scaffolding), 6 (REST assertion) |
| Post-creation token modal (browser only) | 7, 9, 10, 11 |
| Delete-by-token input in settings popup | 9, 10, 11 |
| Creator cookie path unchanged | 3 (auth order), 7 (creator-only token) |
| `allowPadDeletionByAllUsers` default false, threaded everywhere | 1 (scaffolding), 3 (handler), 4 (API) |
| Backend tests (manager + auth matrix + createPad field) | 2, 6 |
| Frontend tests (modal + delete-by-token + negative) | 12 |
| Risk / migration (pre-existing pads, idempotent remove) | Covered by `createDeletionTokenIfAbsent` semantics in Task 1 + Task 2 regression |

All spec sections map to at least one task.

**Placeholders:** none — every code block is complete, every command has expected output.

**Type consistency:**
- `createDeletionTokenIfAbsent(padId)` — consistent across Tasks 1, 2, 7.
- `isValidDeletionToken(padId, token)` — consistent across Tasks 2, 3, 4.
- `removeDeletionToken(padId)` — consistent across Tasks 1, 2.
- `PadDeleteMessage.data.deletionToken?` — Task 3 definition matches Task 10 consumer and Task 12 test usage.
- `clientVars.padDeletionToken` — Task 7 writer, Task 10 reader, Task 12 test assertion all agree on the name and null-semantics.
- `allowPadDeletionByAllUsers` — Task 1 scaffolding, Task 3 handler, Task 4 API, Task 6 REST test all use the same flag.
