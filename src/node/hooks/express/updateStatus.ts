'use strict';

import path from 'node:path';
import {ArgsExpressType} from '../../types/ArgsExpressType';
import settings, {getEpVersion} from '../../utils/Settings';
import {getDetectedInstallMethod, stateFilePath} from '../../updater';
import {evaluatePolicy} from '../../updater/UpdatePolicy';
import {compareSemver, isMajorBehind, isVulnerable} from '../../updater/versionCompare';
import {loadState} from '../../updater/state';
import {isHeld} from '../../updater/lock';


let badgeCache: {value: 'severe' | 'vulnerable' | null; at: number} = {value: null, at: 0};
// Coalesce concurrent computeOutdated() calls during a cache-miss so a burst of
// requests at expiry doesn't fan out into N redundant disk reads.
let badgeInFlight: Promise<'severe' | 'vulnerable' | null> | null = null;
const BADGE_CACHE_MS = 60 * 1000;

const computeOutdated = async (): Promise<'severe' | 'vulnerable' | null> => {
  const state = await loadState(stateFilePath());
  if (!state.latest) return null;
  const current = getEpVersion();
  if (compareSemver(current, state.latest.version) >= 0) return null;
  if (isVulnerable(current, state.vulnerableBelow)) return 'vulnerable';
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
        })
      : null;
    const lockHeld = await isHeld(path.join(settings.root, 'var', 'update.lock'));

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
      vulnerableBelow: state.vulnerableBelow,
      // PR 2 additions:
      execution,
      lastResult,
      lockHeld,
    });
  }));

  cb();
};
