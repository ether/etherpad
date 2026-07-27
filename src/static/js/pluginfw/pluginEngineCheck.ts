'use strict';

import semver from 'semver';

export type EngineCheckResult =
  | {compatible: true}
  | {compatible: false; required: string; current: string};

/**
 * Compares a plugin's `engines.node` range against the runtime Node version.
 *
 * Returned compatibility is used at plugin install time to short-circuit the
 * install with a user-facing "requires a newer version of Etherpad" message
 * instead of letting live-plugin-manager unpack a plugin that will fail at
 * load time on the running Node.
 *
 * Unparseable ranges return `compatible: true` deliberately — this preflight
 * is opportunistic, not a gatekeeper. If we can't make sense of the range
 * we fall through to the existing install path.
 */
export const checkEngineCompatibility = (
  pluginEnginesNode: string | undefined,
  currentNodeVersion: string,
): EngineCheckResult => {
  if (!pluginEnginesNode) return {compatible: true};
  const current = currentNodeVersion.replace(/^v/, '');
  if (!semver.validRange(pluginEnginesNode)) return {compatible: true};
  if (semver.satisfies(current, pluginEnginesNode, {includePrerelease: true})) {
    return {compatible: true};
  }
  return {compatible: false, required: pluginEnginesNode, current};
};

export class EngineIncompatibleError extends Error {
  public readonly code = 'PLUGIN_REQUIRES_NEWER_ETHERPAD';
  constructor(
    public readonly pluginName: string,
    public readonly required: string,
    public readonly current: string,
  ) {
    super(
      `Plugin ${pluginName} requires a newer version of Etherpad. ` +
      'Please upgrade Etherpad and try again.',
    );
    this.name = 'EngineIncompatibleError';
  }
}
