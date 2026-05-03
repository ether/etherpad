# Feature-disabling plugins

Some Etherpad plugins exist specifically to **remove** a baseline feature — `ep_disable_chat`, `ep_disable_change_author_name`, `ep_disable_error_messages`, and so on. When the plugin is installed, the feature it disables is intentionally absent.

This is awkward for CI: the core test suite asserts the disabled feature works. Without coordination, every disable plugin's CI is permanently red, every dependency bump is permanently stuck, and the green/red signal on etherpad.org/plugins becomes meaningless.

To fix that — without giving plugins a free pass to opt out of arbitrary tests — Etherpad uses a small declared-disables contract.

## How it works

### 1. Core specs are tagged by feature

Tests that exercise a single feature carry a Playwright tag like `@feature:chat`:

```ts
test('opens chat, sends a message, makes sure it exists on the page and hides chat', {
  tag: '@feature:chat',
}, async ({page}) => { ... });

test.describe('error sanitization', { tag: '@feature:error-gritter' }, () => { ... });
```

Tags currently in use:

- `@feature:chat`
- `@feature:username`
- `@feature:clear-authorship`
- `@feature:error-gritter`
- `@feature:line-numbers`
- `@feature:rtl-toggle`

### 2. A plugin declares the features it disables in its `ep.json`

```json
{
  "name": "ep_disable_chat",
  "description": "Disable chat",
  "disables": ["@feature:chat"],
  "parts": [...]
}
```

The `disables` field is publicly visible in the plugin's metadata and surfaces on etherpad.org/plugins, so users see the contract before installing.

### 3. The plugin's CI runs the two-pass test script

`bin/run-frontend-tests-with-disables.sh` enforces the contract:

```yaml
# .github/workflows/frontend-tests.yml
- name: Run the frontend tests
  working-directory: ./etherpad-lite/src
  run: ../bin/run-frontend-tests-with-disables.sh -- --project=chromium
```

The script reads `disables` (from `EP_PLUGIN_DISABLES`, an explicit `--plugin-ep-json PATH`, or auto-detection in `plugin_packages/`) and runs two passes:

| Pass | What it runs | Must |
|---|---|---|
| **1. Regression** | Every spec **not** tagged with a disabled feature | Pass — proves the plugin doesn't break anything beyond what it claims to disable. |
| **2. Honesty** | Every spec **that is** tagged with a disabled feature | **Fail** — proves the plugin is genuinely disabling the feature it declares. If those tests pass, the plugin's `disables` claim is wrong. |

Both passes have to succeed for CI to be green.

## What this catches

| Failure mode | Caught by |
|---|---|
| Plugin breaks an unrelated feature | Pass 1 — its tests aren't excluded, they fail, CI red. |
| Plugin claims to disable a feature but the feature still works | Pass 2 — tagged tests pass when they should fail, script exits non-zero. |
| Plugin breaks a feature without declaring it (so etherpad.org/plugins shows it as harmless) | Pass 1 — the feature's tests aren't excluded, they fail, CI red. |
| Plugin lists a feature in `disables` it doesn't actually disable | Pass 2. |

A plugin **cannot** ship green with broken functionality the user can't see ahead of time.

## Adding a new feature tag

When a core spec needs a new feature tag (because a new disable plugin needs to opt out of it):

1. Pick a stable name: `@feature:<area>` — short, lowercase, kebab-case, plural where appropriate.
2. Tag the relevant `test()` or `test.describe()` blocks. Multiple tags are fine: `tag: ['@feature:chat', '@feature:username']`.
3. Update the list above.
4. Submit the tag PR before the plugin's PR — the plugin can then declare `disables` and pass CI.

## Adding a new disable plugin

1. Confirm the feature you're disabling is tagged in core. If not, propose a tag upstream first.
2. Add `"disables": ["@feature:thing"]` to your `ep.json`.
3. Replace the test invocation in `.github/workflows/frontend-tests.yml` with a call to `bin/run-frontend-tests-with-disables.sh` (see `ep_disable_chat` for a worked example).
4. Confirm both passes go green locally before opening the PR.

## Why not just `--grep-invert`?

The earlier draft of this design just told plugin maintainers to add `--grep-invert "<pattern>"` in CI. That works for the regression case (pass 1 above), but it lets a careless or malicious plugin silently skip arbitrary tests and present green CI on etherpad.org/plugins despite breaking unrelated functionality. Pass 2 — and the requirement that disables be declared in `ep.json` rather than inferred from a CI argument — closes that gap.
