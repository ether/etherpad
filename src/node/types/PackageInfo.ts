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
  disables?: string[]
}


export type PackageData = {
  version: string,
  name: string
}