export type PackageInfo =  {
  from: string,
  name: string,
  version: string,
  resolved: string,
  description: string,
  license: string,
  author: {
    name: string
  },
  homepage: string,
  repository: string,
  path: string,
  /**
   * `@feature:*` Playwright tags for core specs the plugin intentionally
   * disables. Sourced from the plugin's ep.json `disables` array; see
   * doc/PLUGIN_FEATURE_DISABLES.md for the contract. Populated by the
   * plugin-registry build pipeline; absent for plugins that don't
   * declare a disables list.
   */
  disables?: string[],
  /**
   * Plugin-registry verdict for the current Etherpad release: `compatible`,
   * `warning` or `failed`. Feed-provided; see pluginCatalogFilter.ts.
   */
  compatibility?: string,
  /**
   * Catalog entries only: published from an ether/* GitHub repository, as
   * shown by npm provenance. Set by core (pluginTrust.ts); the feed's own
   * `official` flag is overwritten because it cannot be verified.
   */
  official?: boolean,
  /**
   * Catalog entries only: a `0.0.0-*` or repository-less package, left out
   * of browsing and listed only on an exact-name search.
   */
  placeholder?: boolean,
  /** Set on *installed* plugins when a newer version is available. */
  updatable?: boolean,
  /** Set on *installed*, updatable plugins: the catalog version an update installs. */
  latestVersion?: string,
  /**
   * Set on *installed* plugins that npm marks deprecated or that core knows
   * to be superseded. Carries the human-readable reason. Never set on
   * catalog entries — those are filtered out instead (#8246).
   */
  deprecated?: string
}


export type PackageData = {
  version: string,
  name: string
}