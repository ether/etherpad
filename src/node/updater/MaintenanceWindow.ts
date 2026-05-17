/**
 * Maintenance-window math for Tier 4 (autonomous updates).
 *
 * Pure — no I/O, no log4js, no globals beyond `Date`. Imported by:
 *   - `UpdatePolicy.ts` (canAutonomous gate)
 *   - `Scheduler.ts`    (snap scheduledFor to the next window opening, defer fires)
 *   - `index.ts`        (compute nextWindowOpensAt for /admin/update/status)
 *   - admin UI picker   (validation)
 *
 * Time semantics
 * --------------
 * A window is a pair of HH:MM wall-clock times plus a `tz` selector. For
 * `tz: 'utc'`, comparisons use `getUTCHours/Minutes` and `Date.UTC(...)`. For
 * `tz: 'local'`, they use the host's local wall clock via the standard `Date`
 * constructor. `nextWindowStart` therefore returns a `Date` whose wall-clock
 * components in the configured tz equal `window.start` — DST transitions are
 * absorbed by the JS Date constructor's normalization (a 02:30 window-start on
 * a spring-forward day silently lands at 03:30 local because 02:30 does not
 * exist; documented behavior, not a bug).
 *
 * Cross-midnight windows are supported (`end < start` means "wraps past
 * 00:00"). The `end` minute is exclusive in both same-day and cross-midnight
 * cases — a `22:00-02:00` window matches `[22:00, 24:00) ∪ [00:00, 02:00)`.
 */

export interface MaintenanceWindow {
  /** Wall-clock start in `HH:MM` (24h). */
  start: string;
  /** Wall-clock end in `HH:MM` (24h). Exclusive. */
  end: string;
  /** Whether `start`/`end` are read against UTC or the host's local clock. */
  tz: 'local' | 'utc';
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

const toMinutes = (hhmm: string): number | null => {
  const m = HHMM.exec(hhmm);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
};

/**
 * Parse and validate a raw value (typically from `settings.json`) into a
 * `MaintenanceWindow`. Returns `null` for any structural or format failure —
 * callers should treat that as "tier 4 disabled, fall back to tier 3".
 */
export const parseWindow = (raw: unknown): MaintenanceWindow | null => {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.start !== 'string' || typeof r.end !== 'string') return null;
  if (r.tz !== 'local' && r.tz !== 'utc') return null;
  const s = toMinutes(r.start);
  const e = toMinutes(r.end);
  if (s == null || e == null) return null;
  if (s === e) return null;
  return {start: r.start, end: r.end, tz: r.tz};
};

const wallMinutes = (now: Date, tz: MaintenanceWindow['tz']): number => (
  tz === 'utc'
    ? now.getUTCHours() * 60 + now.getUTCMinutes()
    : now.getHours() * 60 + now.getMinutes()
);

/**
 * `true` iff `now`'s wall-clock minute is within `[start, end)` in the window's
 * tz. Cross-midnight windows wrap at 24:00 — see file header for the exact set.
 */
export const inWindow = (now: Date, window: MaintenanceWindow): boolean => {
  const s = toMinutes(window.start);
  const e = toMinutes(window.end);
  if (s == null || e == null || s === e) return false;
  const m = wallMinutes(now, window.tz);
  return s < e ? (m >= s && m < e) : (m >= s || m < e);
};

const buildAt = (year: number, month: number, day: number, mins: number,
                 tz: MaintenanceWindow['tz']): Date => {
  const h = Math.floor(mins / 60);
  const mm = mins % 60;
  return tz === 'utc'
    ? new Date(Date.UTC(year, month, day, h, mm, 0, 0))
    : new Date(year, month, day, h, mm, 0, 0);
};

/**
 * Smallest `Date` `t` such that `t >= now` and `t`'s wall-clock equals
 * `window.start` in the window's tz. Used by Scheduler to snap a scheduledFor
 * that lands outside the window forward to the next opening.
 *
 * If `now` is *inside* the window, the next opening is tomorrow — we don't
 * collapse to `now`. Fire-now is gated by `inWindow`, not this function.
 */
export const nextWindowStart = (now: Date, window: MaintenanceWindow): Date => {
  const s = toMinutes(window.start);
  if (s == null) return now;
  const isUtc = window.tz === 'utc';
  const year = isUtc ? now.getUTCFullYear() : now.getFullYear();
  const month = isUtc ? now.getUTCMonth() : now.getMonth();
  const day = isUtc ? now.getUTCDate() : now.getDate();
  const todayStart = buildAt(year, month, day, s, window.tz);
  if (todayStart.getTime() > now.getTime()) return todayStart;
  return buildAt(year, month, day + 1, s, window.tz);
};
