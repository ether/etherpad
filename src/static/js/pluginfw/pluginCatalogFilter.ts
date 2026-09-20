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
 * the catalog populated rather than empty.
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
): CatalogExclusion | null => {
  if (!entry || typeof entry.name !== 'string') return null;
  const superseded = supersededPlugins.get(entry.name);
  if (superseded) return {cause: 'superseded', detail: superseded};
  const deprecation = normalizeDeprecation(npmDeprecation);
  if (deprecation) return {cause: 'deprecated', detail: deprecation};
  if (entry.compatibility === 'failed') {
    return {
      cause: 'incompatible',
      detail: 'The plugin registry could not get this plugin working with ' +
              'the current Etherpad release.',
    };
  }
  return null;
};

/**
 * Applies {@link catalogExclusion} to a whole catalog.
 *
 * @param entries catalog keyed by plugin name.
 * @param deprecations plugin name -> npm deprecation message (or null).
 *   Names missing from the map are treated as "unknown", i.e. not hidden.
 */
export const filterCatalogEntries = <T extends CatalogEntry>(
  entries: Record<string, T>,
  deprecations: ReadonlyMap<string, string | null> = new Map(),
): {kept: Record<string, T>, excluded: Map<string, CatalogExclusion>} => {
  const kept: Record<string, T> = {};
  const excluded = new Map<string, CatalogExclusion>();
  for (const key of Object.keys(entries)) {
    const entry = entries[key];
    const exclusion = entry ? catalogExclusion(entry, deprecations.get(entry.name)) : null;
    if (exclusion) {
      excluded.set(key, exclusion);
    } else {
      kept[key] = entry;
    }
  }
  return {kept, excluded};
};
