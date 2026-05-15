# Auto-Update PR 4 — Tier 4 (autonomous in maintenance window) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land Tier 4 of the auto-update subsystem: when a new release is detected and `updates.tier == "autonomous"` on a writable install with a valid `updates.maintenanceWindow`, schedule the update so that the drain only starts while `now()` is inside the window. Outside the window, the schedule is deferred to the next opening. The admin UI gains a window picker (start/end HH:MM, tz local|utc) with validation and a "next window opens at..." preview.

**Architecture:** Add a new pure module `MaintenanceWindow.ts` with `inWindow(now, window)` and `nextWindowStart(now, window)`. Both handle cross-midnight (`end < start`), local- vs utc-tz selection, and DST transitions (compute against the configured wall clock, not UTC offsets that shift). The `Scheduler.decideSchedule()` and `decideTriggerApply()` decisions take a new `maintenanceWindow` input and a `canAutonomous` policy bit; when the tier is `autonomous`, schedules are placed at `max(now + grace, nextWindowStart)` and trigger-apply aborts (back to `scheduled`) if the window has closed by fire time. `UpdatePolicy.canAutonomous` flips on for `git + tier:autonomous + valid window`. Admin UI adds a picker bound to `updates.maintenanceWindow` via the existing settings round-trip; the UpdatePage scheduled panel shows the resolved next-window time.

**Tech Stack:** TypeScript (Node ≥ 25), Express, log4js, vitest (unit), mocha + supertest (HTTP integration), Playwright (admin UI), React + Zustand (admin UI).

---

## File structure

### New files

- `src/node/updater/MaintenanceWindow.ts` — pure `inWindow(now, window)` + `nextWindowStart(now, window)`. No I/O.
- `src/tests/backend-new/specs/updater/MaintenanceWindow.test.ts` — vitest unit. Same-day, cross-midnight, exact boundary, tz=utc vs tz=local, DST spring-forward + fall-back.
- `src/tests/backend/specs/updater-window-integration.ts` — mocha integration. Latest release detected outside window queues for next opening; entering window triggers fire-now (or grace+window); cancel during deferred-grace returns to idle; window closes mid-grace defers to next window without dropping the schedule.
- `admin/src/components/MaintenanceWindowPicker.tsx` — small controlled component: start (HH:MM), end (HH:MM), tz select, validation message, "next window opens at..." preview.
- `src/tests/frontend-new/admin-spec/update-autonomous.spec.ts` — Playwright: window picker round-trips through Settings; scheduled panel renders "next window opens at..." when waiting; cancel works.

### Modified files

- `src/node/updater/types.ts` — add `MaintenanceWindow` type (`{start: string; end: string; tz: 'local' | 'utc'}`), thread `maintenanceWindow: MaintenanceWindow | null` through `PolicyInput`.
- `src/node/updater/UpdatePolicy.ts` — `canAutonomous` flips on for `git + tier === 'autonomous'` AND a non-null, schema-valid `maintenanceWindow`. Add new policy `reason` value `'maintenance-window-missing'` (denied tier 4 when window not configured) and `'maintenance-window-invalid'` (denied tier 4 when window fails parse).
- `src/node/updater/Scheduler.ts` — extend `DecideScheduleInput` with `maintenanceWindow` + `canAutonomous`; when canAutonomous, `scheduledFor = max(now+grace, nextWindowStart(now+grace, window))`. Extend `decideTriggerApply()` so that when canAutonomous and `inWindow(now, window) === false`, return new action `{action: 'defer'; nextStart: string}`. Extend `SchedulerRunner` to re-arm on defer.
- `src/node/updater/index.ts` — pass `updates.maintenanceWindow` + the autonomous bit into `decideSchedule`/`decideTriggerApply`. On `defer`, persist new `scheduledFor` and re-arm. Log line at `info`: `updater: deferred to next maintenance window at <iso>`.
- `src/node/utils/Settings.ts` — add `maintenanceWindow: MaintenanceWindow | null` to the `updates` settings type; default `null`. Validate shape on boot; on invalid, log a warning and treat as null (do not crash boot).
- `settings.json.template` + `settings.json.docker` — add `"maintenanceWindow": null` line with comment showing example `{"start":"03:00","end":"05:00","tz":"local"}`.
- `src/node/hooks/express/updateStatus.ts` — surface `nextWindowStart` (computed at request time when tier is autonomous + window set) in `GET /admin/update/status` response so the admin UI can show "next window opens at...".
- `src/locales/en.json` — `update.window.start`, `update.window.end`, `update.window.tz_local`, `update.window.tz_utc`, `update.window.validation.format`, `update.window.validation.equal`, `update.window.next_opens_at`, `update.page.scheduled.deferred_until`, `update.page.policy.autonomous_no_window`, `update.page.policy.autonomous_invalid_window`.
- `admin/src/store/store.ts` — extend `Settings.updates` with `maintenanceWindow`; extend response shape returned by `/admin/update/status` with optional `nextWindowOpensAt: string | null`.
- `admin/src/pages/UpdatePage.tsx` — render `MaintenanceWindowPicker` when `tier === 'autonomous'`. Render "Deferred — next window opens at ..." when `execution.status === 'scheduled'` and `scheduledFor > now`. Show explicit `policy.reason` text for `autonomous_no_window` and `autonomous_invalid_window`.
- `admin/src/components/UpdateBanner.tsx` — add a banner variant when `tier === 'autonomous'` but window is missing/invalid: "Autonomous updates are disabled until a maintenance window is configured." Links to `/admin/update`.
- `doc/admin/updates.md` — flip Tier 4 from "designed, not yet implemented" to current; document `maintenanceWindow` shape, cross-midnight, DST behavior, fallback when window is missing.
- `CHANGELOG.md` — Unreleased section entry under `### Added`.
- `docs/superpowers/specs/2026-04-25-auto-update-runbook.md` — append Tier 4 smoke section: configure window 5 min from now, observe deferral, walk window forward, observe fire.

---

## Task 1: Settings schema for `maintenanceWindow`

**Files:**
- Modify: `src/node/utils/Settings.ts`
- Modify: `settings.json.template`
- Modify: `settings.json.docker`
- Modify: `src/node/updater/types.ts` (export `MaintenanceWindow`)
- Test: extend an existing Settings-load test if one exists for `updates`; otherwise rely on Task 4 unit coverage of the window module + boot-time log.

**Steps:**
- [ ] In `src/node/updater/types.ts` add `export interface MaintenanceWindow { start: string; end: string; tz: 'local' | 'utc' }`.
- [ ] In `src/node/utils/Settings.ts` extend the `updates` type with `maintenanceWindow: MaintenanceWindow | null`. Default to `null` in the literal.
- [ ] Add boot-time validation: regex `/^([01]\d|2[0-3]):[0-5]\d$/` for both `start` and `end`; tz must be `'local' | 'utc'`; `start !== end`. On invalid, log warning via `log4js` category `updater` and set to `null` (do not crash). Validation lives in a small pure helper exported from `MaintenanceWindow.ts` (`parseWindow`) so the policy and the UI can reuse it.
- [ ] Edit `settings.json.template` and `settings.json.docker` to include `"maintenanceWindow": null` immediately below `tier`, with a comment showing the shape.

**Verification:**
- [ ] `pnpm exec tsc --noEmit` clean.
- [ ] Boot the server with a deliberately malformed window (`{"start":"oops"}`) and confirm the warning is logged and tier downgrades to `auto` effectively (canAutonomous=false via the policy reason `'maintenance-window-invalid'`).

---

## Task 2: `MaintenanceWindow.ts` module + unit tests

**Files:**
- Create: `src/node/updater/MaintenanceWindow.ts`
- Create: `src/tests/backend-new/specs/updater/MaintenanceWindow.test.ts`

**Steps:**
- [ ] Export `parseWindow(raw: unknown): MaintenanceWindow | null` (returns `null` if shape/format invalid).
- [ ] Export `inWindow(now: Date, window: MaintenanceWindow): boolean`. Compare against the configured tz's wall clock. For `tz: 'utc'` use `getUTCHours/Minutes`; for `tz: 'local'` use `getHours/Minutes`. Cross-midnight (`end < start`): inside if `now ≥ start || now < end`.
- [ ] Export `nextWindowStart(now: Date, window: MaintenanceWindow): Date`. Returns the next `Date` whose wall-clock time equals `start` in the configured tz and which is ≥ `now`. For `tz: 'local'` this is straightforward; for `tz: 'utc'` build via `Date.UTC`. Document via inline comment that DST spring-forward will be handled by the host's `setTimer`/`setTimeout` and we never schedule "into the gap" because we always compare against wall clock.

**Tests (vitest):**
- [ ] `inWindow` — same-day window 03:00-05:00 (inside at 03:30, outside at 02:59, outside at 05:00 (exclusive end)).
- [ ] `inWindow` — cross-midnight 22:00-02:00 (inside at 23:00 and at 01:00; outside at 02:00 and 21:59).
- [ ] `inWindow` — tz=utc respects UTC clock regardless of host TZ (run with `TZ=America/Los_Angeles`).
- [ ] `nextWindowStart` — when `now` is before today's start, returns today at start.
- [ ] `nextWindowStart` — when `now` is inside the window, returns next day's start (callers gate fire-now via `inWindow`, not `nextWindowStart`).
- [ ] `nextWindowStart` — DST spring forward (America/New_York, 2026-03-08, window 02:30-03:30 local): `nextWindowStart` for `now = 2026-03-08T06:00:00Z` resolves to the next wall-clock 02:30 (which is actually 03:30 local on the DST day; document this in the test).
- [ ] `nextWindowStart` — DST fall back (America/New_York, 2026-11-01, window 01:30-02:30 local): assertion that `nextWindowStart` returns the *first* 01:30 wall-clock occurrence.
- [ ] `parseWindow` — accepts `{start:"03:00",end:"05:00",tz:"local"}`; rejects missing fields, malformed times, `start===end`, unknown tz.

**Verification:**
- [ ] `pnpm exec vitest run src/tests/backend-new/specs/updater/MaintenanceWindow.test.ts` green.

---

## Task 3: Extend `UpdatePolicy` with `canAutonomous` and window args

**Files:**
- Modify: `src/node/updater/UpdatePolicy.ts`
- Modify: `src/node/updater/types.ts` (extend `PolicyInput`)
- Modify: `src/tests/backend-new/specs/updater/UpdatePolicy.test.ts`

**Steps:**
- [ ] Extend `PolicyInput` with `maintenanceWindow: MaintenanceWindow | null` (optional, defaults to null in callers).
- [ ] Modify `evaluatePolicy`: when `tier === 'autonomous'` and writable and not terminal:
  - if `maintenanceWindow == null`, `canAutonomous = false`, `reason = 'maintenance-window-missing'`, but keep `canAuto = true`, `canManual = true` (degrade to Tier 3 behavior).
  - if `parseWindow(maintenanceWindow) == null`, same as above with `reason = 'maintenance-window-invalid'`.
  - otherwise `canAutonomous = true`.
- [ ] Update existing tests that asserted `canAutonomous: true` for `tier: 'autonomous'` without a window — they now expect `canAutonomous: false, reason: 'maintenance-window-missing'`. Add new cases for the three policy outcomes.

**Verification:**
- [ ] `pnpm exec vitest run src/tests/backend-new/specs/updater/UpdatePolicy.test.ts` green.

---

## Task 4: Scheduler — gate scheduling + firing on window

**Files:**
- Modify: `src/node/updater/Scheduler.ts`
- Modify: `src/tests/backend-new/specs/updater/Scheduler.test.ts` (extend; create if absent)

**Steps:**
- [ ] Extend `DecideScheduleInput` with `maintenanceWindow: MaintenanceWindow | null` and use `policy.canAutonomous` to decide whether to apply the window gate.
- [ ] In `decideSchedule`, after the existing grace computation, if `canAutonomous && maintenanceWindow`:
  - candidate `scheduledFor = now + grace`.
  - if `inWindow(candidate, window) === false`, set `scheduledFor = nextWindowStart(candidate, window)`.
  - keep the rest of the email/dedupe machinery untouched (`grace-start` email cadence still fires once per tag).
- [ ] In `decideTriggerApply`, add a parameter for the resolved policy plus the window/now. If `policy.canAutonomous && !inWindow(now, window)`, return new decision `{action: 'defer'; nextStart: string}`. The runner persists `scheduledFor = nextStart` and re-arms.
- [ ] In `SchedulerRunner`, extend the timer-fire callback to call `triggerApply` and, on `defer`, re-arm without firing. (The runner is already idempotent on `arm`.)

**Tests (vitest):**
- [ ] `decideSchedule` — canAutonomous + window 03:00-05:00 + now=10:00 → `scheduledFor` snapped to the next 03:00 (not `now + grace`).
- [ ] `decideSchedule` — canAutonomous + window 03:00-05:00 + now=03:30 with grace=0 → `scheduledFor` is `now` (inside window, no snap).
- [ ] `decideTriggerApply` — canAutonomous + outside window → `{action: 'defer', nextStart: <iso>}`.
- [ ] `decideTriggerApply` — canAutonomous + inside window → `{action: 'fire'}`.
- [ ] Email dedupe: defer does not trigger a new `grace-start` email.

**Verification:**
- [ ] `pnpm exec vitest run src/tests/backend-new/specs/updater/Scheduler.test.ts` green.

---

## Task 5: Wire scheduler runner + status endpoint to surface window state

**Files:**
- Modify: `src/node/updater/index.ts`
- Modify: `src/node/hooks/express/updateStatus.ts`
- Modify: `src/tests/backend/specs/updater-actions.ts` (or the equivalent status test) — extend to assert `nextWindowOpensAt` is present when tier=autonomous + window set.

**Steps:**
- [ ] In the periodic check loop, pass `settings.updates.maintenanceWindow` into `decideSchedule`. Pass policy result into both `decideSchedule` and `decideTriggerApply`.
- [ ] On `{action: 'defer'}`, write `state.execution.scheduledFor = nextStart`, persist, `runner.arm(...)`. Emit a log line at INFO category `updater`.
- [ ] In `updateStatus.ts`, when `tier === 'autonomous'` and `maintenanceWindow` parses, compute `nextWindowOpensAt = nextWindowStart(now, window)` and include in the JSON response (`null` otherwise).

**Verification:**
- [ ] `pnpm exec mocha src/tests/backend/specs/updater-actions.ts` green.

---

## Task 6: Admin UI — `MaintenanceWindowPicker` + scheduled-panel "deferred until"

**Files:**
- Create: `admin/src/components/MaintenanceWindowPicker.tsx`
- Modify: `admin/src/pages/UpdatePage.tsx`
- Modify: `admin/src/components/UpdateBanner.tsx`
- Modify: `admin/src/store/store.ts`
- Modify: `src/locales/en.json`
- Test: `src/tests/frontend-new/admin-spec/update-autonomous.spec.ts`

**Steps:**
- [ ] `MaintenanceWindowPicker.tsx` — controlled component over `value: {start, end, tz} | null`, emits `onChange`. Inline validation message via i18n keys `update.window.validation.format` / `update.window.validation.equal`. Below the picker, render the resolved `nextWindowOpensAt` (passed in via prop) with key `update.window.next_opens_at`.
- [ ] In `UpdatePage.tsx`, when `settings.updates.tier === 'autonomous'`, render the picker. Wiring through the existing settings round-trip (the parsed settings editor PR #7709 lands first; if it's not yet on develop at integration time, fall back to writing through `/admin/settings`).
- [ ] When `execution.status === 'scheduled'` and `policy.canAutonomous` and `scheduledFor > now`, render the scheduled panel with the deferral subtitle (`update.page.scheduled.deferred_until`).
- [ ] In `UpdateBanner.tsx`, render the "configure maintenance window" banner when `policy.reason === 'maintenance-window-missing' | 'maintenance-window-invalid'` and `tier === 'autonomous'`.
- [ ] Add all i18n keys to `en.json`. **Always i18n, never hardcoded** (memory: `feedback_always_i18n`).

**Tests (Playwright):**
- [ ] Window picker saves a value; reload restores it.
- [ ] Invalid input shows the validation message and does not save.
- [ ] When tier=autonomous + window set + outside window, the scheduled panel shows "Next window opens at HH:MM (local)".
- [ ] When tier=autonomous + window missing, the banner renders the link to `/admin/update`.

**Verification:**
- [ ] `pnpm --filter ep_etherpad-lite exec playwright test src/tests/frontend-new/admin-spec/update-autonomous.spec.ts` green (port 9003 per memory `feedback_test_port_9003`).

---

## Task 7: Window-boundary integration test

**Files:**
- Create: `src/tests/backend/specs/updater-window-integration.ts`

**Cases:**
- [ ] Outside window: VersionChecker sees a new release; Scheduler arms `scheduledFor = nextWindowStart`; no drain starts.
- [ ] Enter window: clock advances to inside-window; fire-time `decideTriggerApply` returns `fire`; drain starts.
- [ ] Cancel during deferred-grace: `/admin/update/cancel` returns 200 and `execution.status` returns to `idle`.
- [ ] Window closes mid-grace: clock advances past `end` before fire; `decideTriggerApply` returns `defer`; state persists with new `scheduledFor`; runner re-arms.

**Verification:**
- [ ] `pnpm exec mocha src/tests/backend/specs/updater-window-integration.ts` green.

---

## Task 8: Docs, runbook, CHANGELOG

**Files:**
- Modify: `doc/admin/updates.md`
- Modify: `docs/superpowers/specs/2026-04-25-auto-update-runbook.md`
- Modify: `CHANGELOG.md`

**Steps:**
- [ ] Flip the Tier 4 section in `doc/admin/updates.md` from "designed, not yet implemented" to current. Document `maintenanceWindow` shape, cross-midnight, DST behavior, and the policy fallback when the window is missing or invalid.
- [ ] Append a Tier 4 smoke section to the runbook: configure window 5 min from now, observe deferral, walk window forward, observe fire, observe rollback path inside window still works.
- [ ] Add an `Unreleased` entry to `CHANGELOG.md` under `### Added`.

**Verification:**
- [ ] Manual: `pnpm run dev` on a clean checkout with `tier: "autonomous"` + a near-future 2-minute window and confirm the admin UI matches the documented flow.

---

## Cross-cutting checks before opening the PR

- [ ] `pnpm exec tsc --noEmit` clean (root + admin).
- [ ] `pnpm exec vitest run` green (backend-new).
- [ ] `pnpm exec mocha src/tests/backend/specs/updater-*.ts` green.
- [ ] Playwright admin spec green under `pnpm --filter ep_etherpad-lite exec playwright test src/tests/frontend-new/admin-spec/update-autonomous.spec.ts` on port 9003.
- [ ] `pnpm run build:ui` succeeds.
- [ ] Manual smoke runbook Tier 4 section completed against a disposable VM (canary deferred to merge if the 2-week canary requirement from spec §"Ship gate" is dropped; otherwise gate merge on canary).
- [ ] PR title `feat(updater): tier 4 — autonomous update in maintenance window (#7607)`.
- [ ] PR body links to the spec + this plan, lists settings additions, and links to PRs #7601 / #7704 / #7720.
- [ ] After merge, close issue #7607 with a summary comment linking all four PRs.
