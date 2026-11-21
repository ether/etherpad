'use strict';

/**
 * Catalog hygiene for the admin "Available plugins" list (#8246).
 *
 * The plugin feed (`${updateServer}/plugins.json`) is a flat list of every
 * `ep_*` package the registry knows about. It carries no deprecation data,
 * so before this module every package in the feed was offered for install —
 * including packages that are known not to work with the running Etherpad.
 *
 * Three signals are combined here, cheapest first:
 *
 *   1. `compatibility` — the feed's own verdict, one of `compatible`,
 *      `warning` or `failed`. `failed` means the registry's compatibility
 *      run could not get the plugin working against current Etherpad, so
 *      those are not offered. `warning` is still offered.
 *   2. `superseded` — a short, deliberately hand-maintained list of packages
 *      that install cleanly but break a working Etherpad. Entries are
 *      expected to be temporary: the durable fix is `npm deprecate`, which
 *      signal 3 picks up automatically.
 *   3. npm deprecation — `deprecated` on the published version metadata,
 *      fetched by the caller (installer.ts) and passed in here. Looking it
 *      up is the caller's job so that this module stays pure and testable.
 *
 * Everything is fail-open: a plugin is only hidden when a signal positively
 * says it is broken. A network failure while collecting signal 3 must leave
 * the catalog populated rather than empty. The same goes for signal 1: when
 * the feed marks most of the catalog `failed`, that says the registry's
 * compatibility run broke, not that the plugins did, so the verdict is
 * ignored for that feed (see {@link isCompatibilitySignalPlausible}).
 */

export type CatalogEntry = {
  name: string,
  version?: string,
  /** Feed-provided verdict: 'compatible' | 'warning' | 'failed'. */
  compatibility?: string,
};

export type CatalogExclusion = {
  /** Machine-readable cause, for logs and tests. */
  cause: 'superseded' | 'deprecated' | 'incompatible',
  /** Human-readable detail. For 'deprecated' this is the upstream message. */
  detail: string,
};

/**
 * Packages that npm has not (yet) marked deprecated but that are known to
 * break the admin UI or the editor on a current Etherpad. Keep this list
 * short and keep a reason on every line — an entry here is a stopgap until
 * the package is deprecated on npm, at which point it should be removed.
 */
export const supersededPlugins: ReadonlyMap<string, string> = new Map([
  ['ep_adminpads2',
    'Archived upstream and replaced by the built-in Manage pads page. It ' +
    'registers /admin/pads ahead of the core route and its template loads ' +
    'scripts core no longer ships, so installing it breaks the admin UI ' +
    '(ether/etherpad#8246).'],
]);

/**
 * Turns whatever npm put in `deprecated` into either a message or null.
 * npm normally stores a string, but an un-deprecated package can end up
 * with `false` or an empty string, and very old records used `true`.
 */
export const normalizeDeprecation = (raw: unknown): string | null => {
  if (raw === true) return 'Deprecated on npm.';
  if (typeof raw !== 'string') return null;
  const msg = raw.trim();
  return msg === '' ? null : msg;
};

/**
 * Decides whether a single catalog entry should be offered for install.
 *
 * @param entry feed entry
 * @param npmDeprecation deprecation message for the offered version, `null`
 *   if the package is known not to be deprecated, `undefined` if it could
 *   not be determined (network failure) — which is treated as not deprecated.
 * @returns the reason to hide the entry, or null to keep it.
 */
export const catalogExclusion = (
  entry: CatalogEntry,
  npmDeprecation?: string | null,
  {trustCompatibility = true}: {trustCompatibility?: boolean} = {},
): CatalogExclusion | null => {
  if (!entry || typeof entry.name !== 'string') return null;
  const superseded = supersededPlugins.get(entry.name);
  if (superseded) return {cause: 'superseded', detail: superseded};
  const deprecation = normalizeDeprecation(npmDeprecation);
  if (deprecation) return {cause: 'deprecated', detail: deprecation};
  if (trustCompatibility && entry.compatibility === 'failed') {
    return {
      cause: 'incompatible',
      detail: 'The plugin registry could not get this plugin working with ' +
              'the current Etherpad release.',
    };
  }
  return null;
};

/**
 * Why an install must be refused, or null when it may go ahead.
 *
 * Hiding a package from the catalog is not enough on its own: a stale admin
 * page, an older client or a replayed socket event can still ask the server
 * to install something the refreshed catalog would not offer. The install
 * path applies the same policy, minus the feed-only `compatibility` signal
 * which it has no entry for.
 *
 * `pnpm run plugins i ep_<name>` goes through LinkInstaller directly and is
 * deliberately unaffected — an operator on the server can still override.
 */
export const installBlockReason = (
  pluginName: string,
  npmDeprecation?: string | null,
): CatalogExclusion | null => catalogExclusion({name: pluginName}, npmDeprecation);

export class PluginDeprecatedError extends Error {
  public readonly code = 'PLUGIN_DEPRECATED';
  constructor(public readonly pluginName: string, public readonly detail: string) {
    super(`Plugin ${pluginName} is no longer maintained and is not offered by the ` +
          `plugin catalog: ${detail}`);
    this.name = 'PluginDeprecatedError';
  }
}

/**
 * Below this many entries the share of `failed` verdicts says nothing about
 * the health of the compatibility run, so the verdicts are always trusted.
 */
export const COMPATIBILITY_MIN_SAMPLE = 20;

/**
 * Largest share of the catalog the registry can plausibly mark `failed`.
 * A healthy run fails a handful of plugins (10 of 174 when #8246 landed);
 * on 2026-11-21 a broken run marked 175 of 180 `failed`, including ep_align,
 * and every admin catalog went empty.
 */
export const COMPATIBILITY_MAX_FAILED_SHARE = 0.5;

/**
 * Whether the feed's `failed` verdicts can be believed. When most of a
 * non-trivial catalog is marked `failed`, the registry's compatibility run
 * itself is broken, and hiding on that signal would empty the catalog — the
 * outcome this module is designed never to produce.
 */
export const isCompatibilitySignalPlausible = (
  entries: ReadonlyArray<CatalogEntry | null | undefined>,
): boolean => {
  const valid = entries.filter((e): e is CatalogEntry => !!e && typeof e.name === 'string');
  if (valid.length < COMPATIBILITY_MIN_SAMPLE) return true;
  const failed = valid.filter((e) => e.compatibility === 'failed').length;
  return failed / valid.length <= COMPATIBILITY_MAX_FAILED_SHARE;
};

/**
 * Applies {@link catalogExclusion} to a whole catalog.
 *
 * @param entries catalog keyed by plugin name.
 * @param deprecations plugin name -> npm deprecation message (or null).
 *   Names missing from the map are treated as "unknown", i.e. not hidden.
 * @returns the kept and excluded entries, and whether the feed's
 *   compatibility verdicts were ignored as implausible.
 */
export const filterCatalogEntries = <T extends CatalogEntry>(
  entries: Record<string, T>,
  deprecations: ReadonlyMap<string, string | null> = new Map(),
): {
  kept: Record<string, T>,
  excluded: Map<string, CatalogExclusion>,
  compatibilityIgnored: boolean,
} => {
  const kept: Record<string, T> = {};
  const excluded = new Map<string, CatalogExclusion>();
  const trustCompatibility = isCompatibilitySignalPlausible(Object.values(entries));
  for (const key of Object.keys(entries)) {
    const entry = entries[key];
    const exclusion = entry
      ? catalogExclusion(entry, deprecations.get(entry.name), {trustCompatibility})
      : null;
    if (exclusion) {
      excluded.set(key, exclusion);
    } else {
      kept[key] = entry;
    }
  }
  return {kept, excluded, compatibilityIgnored: !trustCompatibility};
};
