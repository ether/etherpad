'use strict';

import path from 'node:path';
import {ArgsExpressType} from '../../types/ArgsExpressType';
import settings, {getEpVersion} from '../../utils/Settings';
import {getDetectedInstallMethod, stateFilePath} from '../../updater';
import {evaluatePolicy} from '../../updater/UpdatePolicy';
import {compareSemver, isMajorBehind} from '../../updater/versionCompare';
import {loadState} from '../../updater/state';
import {isHeld} from '../../updater/lock';
import {nextWindowStart, parseWindow} from '../../updater/MaintenanceWindow';


/**
 * Returns the authorID of whoever first contributed to the pad — i.e. the
 * `['author', X]` entry at the lowest numeric key in the pool, with empty-X
 * placeholders skipped. Returns null for a pad with no real author attribs yet.
 */
export const firstAuthorOf = (pad: {pool?: {numToAttrib?: Record<number | string, unknown>}}): string | null => {
  const num2attrib = pad?.pool?.numToAttrib;
  if (!num2attrib) return null;
  const keys = Object.keys(num2attrib).map(Number).sort((a, b) => a - b);
  for (const k of keys) {
    const a = num2attrib[k];
    if (Array.isArray(a) && a[0] === 'author' && typeof a[1] === 'string' && a[1] !== '') {
      return a[1];
    }
  }
  return null;
};

/**
 * Resolve the express-session author for a plain HTTP GET. The pad-side fetch
 * is `credentials: 'same-origin'`, so the `express_sid` cookie is sent
 * automatically. The global express-session middleware should have populated
 * `req.session` already — but if not (e.g. test harness without middleware),
 * we re-invoke it ourselves. On any failure path we return null and the
 * caller treats the request as anonymous.
 */
export const resolveRequestAuthor = async (req: any): Promise<string | null> => {
  const readAuthor = (): string | null => {
    const a = req?.session?.user?.author;
    return typeof a === 'string' && a !== '' ? a : null;
  };
  const fromSession = readAuthor();
  if (fromSession !== null) return fromSession;
  try {
    const expressModule = await import('../express');
    const mw = (expressModule as any).sessionMiddleware;
    if (typeof mw !== 'function') return null;
    await new Promise<void>((resolve, reject) => {
      mw(req, {} as any, (err?: unknown) => (err ? reject(err) : resolve()));
    });
  } catch {
    return null;
  }
  return readAuthor();
};

let badgeCache: {value: 'severe' | null; at: number} = {value: null, at: 0};
// Coalesce concurrent computeOutdated() calls during a cache-miss so a burst of
// requests at expiry doesn't fan out into N redundant disk reads.
let badgeInFlight: Promise<'severe' | null> | null = null;
const BADGE_CACHE_MS = 60 * 1000;

const computeOutdated = async (): Promise<'severe' | null> => {
  const state = await loadState(stateFilePath());
  if (!state.latest) return null;
  const current = getEpVersion();
  if (compareSemver(current, state.latest.version) >= 0) return null;
  if (isMajorBehind(current, state.latest.version)) return 'severe';
  return null;
};

/** Test-only: clear the in-memory badge cache so integration tests see fresh state. */
export const _resetBadgeCacheForTests = (): void => {
  badgeCache = {value: null, at: 0};
  badgeInFlight = null;
};

// Wrap an async Express handler so a rejected promise becomes next(err) rather than
// an unhandled rejection. Mirrors the .catch(next) pattern used elsewhere in the repo.
const wrapAsync = (fn: (req: any, res: any, next: Function) => Promise<unknown>) =>
  (req: any, res: any, next: Function) => {
    Promise.resolve(fn(req, res, next)).catch((err) => next(err));
  };

/**
 * Strip diagnostic strings (reason, fromSha, targetTag, build/install paths)
 * from execution before exposing to unauthenticated callers. Status enum is
 * preserved so the admin banner / pad-side badge can still render the right UI.
 */
const sanitizeExecution = (e: any): any => {
  if (!e || typeof e !== 'object' || typeof e.status !== 'string') return {status: 'idle'};
  return {status: e.status};
};

const sanitizeLastResult = (r: any): any => {
  if (r === null) return null;
  if (!r || typeof r !== 'object' || typeof r.outcome !== 'string') return null;
  // outcome enum + at timestamp are non-sensitive. reason / fromSha / targetTag are dropped.
  return {outcome: r.outcome, at: typeof r.at === 'string' ? r.at : null};
};

export const expressCreateServer = (
  _hookName: string,
  {app}: ArgsExpressType,
  cb: Function,
): void => {
  // Tier "off" disables the entire updater feature, including its HTTP surface.
  if (settings.updates.tier === 'off') return cb();

  // Public endpoint. Cached for 60s. Returns only an enum — no version string.
  app.get('/api/version-status', wrapAsync(async (_req, res) => {
    const now = Date.now();
    if (now - badgeCache.at > BADGE_CACHE_MS) {
      // Single-flight: if another request is already computing, await its
      // promise instead of starting a second one. The first to land seeds
      // the cache; the rest read it.
      if (!badgeInFlight) {
        badgeInFlight = computeOutdated().finally(() => { badgeInFlight = null; });
      }
      const value = await badgeInFlight;
      // Only the request that observed the original miss writes the cache;
      // followers may race on the assignment but write the same value.
      badgeCache = {value, at: now};
    }
    res.json({outdated: badgeCache.value});
  }));

  // Admin UI status endpoint. By default this is open: the running version is already
  // exposed publicly via /health, and latest/changelog come from a public GitHub
  // release. Admins who want the endpoint gated to authenticated admin sessions —
  // without disabling the updater entirely — set updates.requireAdminForStatus=true.
  app.get('/admin/update/status', wrapAsync(async (req, res) => {
    const isAdmin = !!req.session?.user?.is_admin;
    if (settings.updates.requireAdminForStatus) {
      const user = req.session?.user;
      if (!user) return res.status(401).send('Authentication required');
      if (!user.is_admin) return res.status(403).send('Forbidden');
    }
    const state = await loadState(stateFilePath());
    const current = getEpVersion();
    const installMethod = getDetectedInstallMethod();
    const policy = state.latest
      ? evaluatePolicy({
          installMethod,
          tier: settings.updates.tier,
          current,
          latest: state.latest.version,
          executionStatus: state.execution.status,
          maintenanceWindow: settings.updates.maintenanceWindow,
        })
      : null;
    const lockHeld = await isHeld(path.join(settings.root, 'var', 'update.lock'));
    // Tier 4: surface the configured window + the next opening so the admin UI
    // can render the picker and the "deferred until..." subtitle on the
    // scheduled panel. Non-admin requests get null for both fields (the parsed
    // window is operational config, not a public datum).
    const parsedWindow = parseWindow(settings.updates.maintenanceWindow);
    const maintenanceWindow = isAdmin ? parsedWindow : null;
    const nextWindowOpensAt = isAdmin && parsedWindow && settings.updates.tier === 'autonomous'
      ? nextWindowStart(new Date(), parsedWindow).toISOString()
      : null;

    // The Tier 2 fields (execution, lastResult) carry diagnostic strings
    // built from git/pnpm stderr — environment-specific paths, error
    // messages, etc. Endpoint defaults to unauthenticated; only authed
    // admin sessions see the full diagnostic payload. Everyone else sees
    // just the status enum + outcome enum so the pad-side / public banners
    // can still render correctly without leaking operational detail.
    const execution = isAdmin
      ? state.execution
      : sanitizeExecution(state.execution);
    const lastResult = isAdmin
      ? state.lastResult
      : sanitizeLastResult(state.lastResult);

    res.json({
      currentVersion: current,
      latest: state.latest,
      lastCheckAt: state.lastCheckAt,
      installMethod,
      tier: settings.updates.tier,
      policy,
      // PR 2 additions:
      execution,
      lastResult,
      lockHeld,
      // PR 4 additions:
      maintenanceWindow,
      nextWindowOpensAt,
    });
  }));

  cb();
};
