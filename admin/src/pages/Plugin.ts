export type PluginDef = {
    name: string,
    description: string,
    version: string,
    time: string,
    official: boolean,
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
