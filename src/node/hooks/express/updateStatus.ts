'use strict';

import path from 'node:path';
import {ArgsExpressType} from '../../types/ArgsExpressType';
import settings from '../../utils/Settings';
import {getDetectedInstallMethod} from '../../updater';
import {evaluatePolicy} from '../../updater/UpdatePolicy';
import {compareSemver, isMajorBehind, isVulnerable} from '../../updater/versionCompare';
import {loadState} from '../../updater/state';

const getEpVersion = (): string => require('../../../package.json').version;

const stateFilePath = (): string => path.join(settings.root, 'var', 'update-state.json');

let badgeCache: {value: 'severe' | 'vulnerable' | null; at: number} = {value: null, at: 0};
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
};

export const expressCreateServer = (
  _hookName: string,
  {app}: ArgsExpressType,
  cb: Function,
): void => {
  // Public endpoint. Cached for 60s. Returns only an enum — no version string.
  app.get('/api/version-status', async (_req: any, res: any) => {
    const now = Date.now();
    if (now - badgeCache.at > BADGE_CACHE_MS) {
      badgeCache = {value: await computeOutdated(), at: now};
    }
    res.json({outdated: badgeCache.value});
  });

  // Admin-protected. webaccess.ts already gates /admin/* with admin auth.
  app.get('/admin/update/status', async (_req: any, res: any) => {
    const state = await loadState(stateFilePath());
    const current = getEpVersion();
    const installMethod = getDetectedInstallMethod();
    const policy = state.latest
      ? evaluatePolicy({installMethod, tier: settings.updates.tier, current, latest: state.latest.version})
      : null;
    res.json({
      currentVersion: current,
      latest: state.latest,
      lastCheckAt: state.lastCheckAt,
      installMethod,
      tier: settings.updates.tier,
      policy,
      vulnerableBelow: state.vulnerableBelow,
    });
  });

  cb();
};
