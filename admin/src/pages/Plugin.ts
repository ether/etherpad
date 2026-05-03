export type PluginDef = {
  name: string,
  description: string,
  version: string,
  time: string,
  official: boolean,
  /**
   * `@feature:*` Playwright tags for core specs the plugin intentionally
   * disables. See doc/PLUGIN_FEATURE_DISABLES.md. May be undefined for
   * plugins without a disables list, which is the common case.
   */
  disables?: string[],
}


export type InstalledPlugin = {
  name: string,
  path: string,
  realPath: string,
  version:string,
  updatable?: boolean
}


export type SearchParams = {
  searchTerm: string,
  offset: number,
  limit: number,
  sortBy: 'name'|'version'|'last-updated',
  sortDir: 'asc'|'desc'
}


export type HelpObj = {
  epVersion: string
  gitCommit: string
  installedClientHooks: Record<string, Record<string, string>>,
  installedParts: string[],
  installedPlugins: string[],
  installedServerHooks: Record<string, never>,
  latestVersion: string
}
