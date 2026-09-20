'use strict';

import log4js from "log4js";

import {PackageData, PackageInfo} from "../../../node/types/PackageInfo";
import {MapArrayType} from "../../../node/types/MapType";

import path from "path";

import {promises as fs} from "fs";

const plugins = require('./plugins');
const hooks = require('./hooks');
const runCmd = require('../../../node/utils/run_cmd');
import  settings, {
  getEpVersion,
  reloadSettings
} from '../../../node/utils/Settings';
import {LinkInstaller} from "./LinkInstaller";
import {assertPluginCatalogEnabled} from "./pluginCatalogGuard";
import {
  checkEngineCompatibility,
  EngineIncompatibleError,
} from './pluginEngineCheck';
import {
  CatalogEntry,
  filterCatalogEntries,
  installBlockReason,
  normalizeDeprecation,
  PluginDeprecatedError,
} from './pluginCatalogFilter';
import {InstallerTaskQueue} from './installerTasks';

import {findEtherpadRoot} from '../../../node/utils/AbsolutePaths';
const logger = log4js.getLogger('plugins');
const npmRegistry = 'https://registry.npmjs.org';

export const pluginInstallPath = path.join(settings.root, 'src','plugin_packages');
export const node_modules = path.join(findEtherpadRoot(),'src', 'node_modules');

export const installedPluginsPath = path.join(settings.root, 'var/installed_plugins.json');

const onAllTasksFinished = async () => {
  await plugins.update();
  await persistInstalledPlugins();
  reloadSettings();
  await hooks.aCallAll('loadSettings', {settings});
  await hooks.aCallAll('restartServer');
};

const headers = {
  'User-Agent': `Etherpad/${getEpVersion()}`,
};

export const linkInstaller = new LinkInstaller();

const taskQueue = new InstallerTaskQueue(onAllTasksFinished);
const wrapTaskCb = (cb: Function | null) => taskQueue.wrap(cb);

const migratePluginsFromNodeModules = async () => {
  logger.info('start migration of plugins in node_modules');
  // Notes:
  //   * Do not pass `--prod` otherwise `pnpm ls` will fail if there is no `package.json`.
  //   * The `--no-prod` flag is required (or the `NODE_ENV` environment variable must be
  //     unset or set to `development`) because otherwise `pnpm ls` will not mention any packages
  //     that are not included in `package.json` (which is expected to not exist).
  //     (pnpm 12 renamed `--no-production` to `--no-prod`.)
  const cmd = ['pnpm', 'ls', '--long', '--json', '--depth=0', '--no-prod'];
  const [{dependencies = {}}] = JSON.parse(await runCmd(cmd,
      {stdio: [null, 'string']}));

  await Promise.all(Object.entries(dependencies)
      .filter(([pkg, info]) => pkg.startsWith(plugins.prefix) && pkg !== 'ep_etherpad-lite')
      .map(async ([pkg, info]) => {
          const _info = info as PackageInfo
          if (!_info.resolved) {
          // Install from node_modules directory
          await linkInstaller.installFromPath(`${findEtherpadRoot()}/node_modules/${pkg}`);
        } else {
          await linkInstaller.installPlugin(pkg);
        }
      }));
  await persistInstalledPlugins();
};

export const checkForMigration = async () => {
  logger.info('check installed plugins for migration');
  // Initialize linkInstaller
  await linkInstaller.init()

  try {
    await fs.access(installedPluginsPath, fs.constants.F_OK);
  } catch (err) {
    await migratePluginsFromNodeModules();
  }

  /*
  * Check if the plugin is already installed in node_modules
  * If not, create a symlink to node_modules
  * This is necessary as
  * 1. Live Plugin Manager does not support loading plugins from the directory so that node can access them normally
  * 2. Plugins can't be directly installed to node_modules otherwise upgrading Etherpad will remove them
 */


  fs.stat(pluginInstallPath).then(async (err) => {
    const files = await fs.readdir(pluginInstallPath);

    for (let file of files){
      const moduleName = path.basename(file);
      if (moduleName === '.versions') {
        // Skip the directory using live-plugin-manager
        continue;
      }
      try {
        await fs.access(path.join(node_modules, moduleName), fs.constants.F_OK);
        logger.debug(`plugin ${moduleName} already exists in node_modules`);
      } catch (err) {
        // Create symlink to node_modules
        logger.debug(`create symlink for ${file} to ${path.join(node_modules,moduleName)}`)
        await fs.symlink(path.join(pluginInstallPath,file), path.join(node_modules,moduleName), 'dir')
      }
    }
  }).catch(()=>{
    logger.debug('plugin directory does not exist');
  })
  const fileContent = await fs.readFile(installedPluginsPath);
  const installedPlugins = JSON.parse(fileContent.toString());

  for (const plugin of installedPlugins.plugins) {
    if (plugin.name.startsWith(plugins.prefix) && plugin.name !== 'ep_etherpad-lite') {
      try {
        await linkInstaller.installPlugin(plugin.name, plugin.version);
      } catch (e) {
        logger.error(`Error installing plugin ${plugin.name} with version ${plugin.version}: ${e}`);
      }
    }
  }
};

const persistInstalledPlugins = async () => {
  const installedPlugins:{
    plugins: PackageData[]
  } = {plugins: []};
  for (const pkg of Object.values(await plugins.getPackages()) as PackageData[]) {
    installedPlugins.plugins.push({
      name: pkg.name,
      version: pkg.version,
    });
  }
  installedPlugins.plugins = [...new Set(installedPlugins.plugins)];
  await fs.writeFile(installedPluginsPath, JSON.stringify(installedPlugins));
};

export const uninstall = async (pluginName: string, cb:Function|null = null) => {
  cb = wrapTaskCb(cb);
  logger.info(`Uninstalling plugin ${pluginName}...`);

  await linkInstaller.uninstallPlugin(pluginName);
  logger.info(`Successfully uninstalled plugin ${pluginName}`);
  await hooks.aCallAll('pluginUninstall', {pluginName});
  cb(null);
};

// Best-effort lookup of the published plugin's metadata (engines.node range
// and npm deprecation notice). Returns undefined on any failure (network,
// 404, parse error, timeout) so the caller falls through to the existing
// install path rather than blocking on a flaky registry call. A 5s
// AbortSignal.timeout guards against a stalled registry hanging the install
// promise forever — without it the finished:install socket event would never
// fire and the admin UI would stay spinning indefinitely.
const ENGINES_PREFLIGHT_TIMEOUT_MS = 5000;
type NpmVersionMeta = {engines?: {node?: string}, deprecated?: unknown};
const fetchPluginVersionMeta = async (
  pluginName: string,
  version = 'latest',
  signal?: AbortSignal,
): Promise<NpmVersionMeta | undefined> => {
  try {
    const res = await fetch(
      `${npmRegistry}/${encodeURIComponent(pluginName)}/${encodeURIComponent(version)}`,
      {headers, signal: signal ?? AbortSignal.timeout(ENGINES_PREFLIGHT_TIMEOUT_MS)},
    );
    if (!res.ok) return undefined;
    return await res.json() as NpmVersionMeta;
  } catch (err) {
    logger.debug(`npm metadata lookup for ${pluginName}@${version} fell through: ${err}`);
    return undefined;
  }
};

// Deprecation lookups are cached by name@version because a published version
// is immutable apart from its deprecation flag, which changes maybe once in
// a package's lifetime. Without the cache the admin plugin page would hit
// the npm registry once per listed plugin on every catalog refresh.
const DEPRECATION_TTL_MS = 12 * 60 * 60 * 1000;
const DEPRECATION_SWEEP_BUDGET_MS = 15000;
const DEPRECATION_CONCURRENCY = 8;
const DEPRECATION_CACHE_MAX = 1000;
const deprecationCache = new Map<string, {deprecated: string | null, expires: number}>();
// Lookups that have been started but not finished, so two concurrent sweeps
// (the admin page fires `getInstalled` and `search` together) join one
// request per package instead of issuing two. `undefined` means the lookup
// failed, i.e. the deprecation state is unknown.
const deprecationInFlight = new Map<string, Promise<string | null | undefined>>();

// Exported for tests; also lets an operator-triggered catalog reload pick up
// a deprecation published in the last 12 hours.
export const clearDeprecationCache = () => deprecationCache.clear();

/**
 * Looks up the npm deprecation notice for each of the given packages.
 *
 * Fail-open by design: a package whose lookup fails (offline, npm blocked by
 * a firewall, 404, timeout, overall budget exceeded) is simply absent from
 * the returned map, and the caller then treats it as not deprecated. An
 * admin behind a firewall gets the full catalog, not an empty one.
 */
export const fetchPluginDeprecations = async (
  pkgs: ReadonlyArray<{name: string, version?: string}>,
): Promise<Map<string, string | null>> => {
  const result = new Map<string, string | null>();
  const pending: Array<{name: string, version: string, key: string}> = [];
  const now = Date.now();
  if (deprecationCache.size > DEPRECATION_CACHE_MAX) deprecationCache.clear();
  for (const pkg of pkgs) {
    if (!pkg || typeof pkg.name !== 'string') continue;
    const version = typeof pkg.version === 'string' && pkg.version ? pkg.version : 'latest';
    const key = `${pkg.name}@${version}`;
    const cached = deprecationCache.get(key);
    if (cached && cached.expires > now) {
      result.set(pkg.name, cached.deprecated);
    } else {
      pending.push({name: pkg.name, version, key});
    }
  }
  if (pending.length === 0) return result;

  // One controller for the whole sweep: if the registry is slow we give up
  // on the remainder rather than making the admin page wait indefinitely.
  const budget = AbortSignal.timeout(DEPRECATION_SWEEP_BUDGET_MS);
  const lookup = (job: {name: string, version: string, key: string}) => {
    const started = deprecationInFlight.get(job.key);
    if (started) return started;
    const promise = (async () => {
      const meta = await fetchPluginVersionMeta(job.name, job.version, budget);
      if (meta === undefined) return undefined; // unknown -> not hidden
      const deprecated = normalizeDeprecation(meta.deprecated);
      deprecationCache.set(job.key, {deprecated, expires: Date.now() + DEPRECATION_TTL_MS});
      return deprecated;
    })().finally(() => deprecationInFlight.delete(job.key));
    deprecationInFlight.set(job.key, promise);
    return promise;
  };
  let index = 0;
  const worker = async () => {
    while (index < pending.length) {
      if (budget.aborted) return;
      const job = pending[index++];
      const deprecated = await lookup(job);
      if (deprecated !== undefined) result.set(job.name, deprecated);
    }
  };
  await Promise.all(
    Array.from({length: Math.min(DEPRECATION_CONCURRENCY, pending.length)}, worker));
  if (budget.aborted && result.size < pkgs.length) {
    logger.warn('Plugin catalog: npm deprecation lookup timed out; ' +
                'listing the plugins it could not check.');
  }
  return result;
};

export const install = async (pluginName: string, cb:Function|null = null) => {
  cb = wrapTaskCb(cb);
  logger.info(`Installing plugin ${pluginName}...`);
  try {
    // A superseded package is refused before any network call, so the block
    // holds even when npm is unreachable.
    const known = installBlockReason(pluginName);
    if (known) throw new PluginDeprecatedError(pluginName, known.detail);
    const meta = await fetchPluginVersionMeta(pluginName);
    const compat = checkEngineCompatibility(meta?.engines?.node, process.version);
    if (!compat.compatible) {
      throw new EngineIncompatibleError(pluginName, compat.required, compat.current);
    }
    // The catalog does not offer deprecated plugins, but a stale admin page,
    // an older client or a replayed socket event can still ask for one, so
    // the same policy is applied here (#8246). Deciding from the npm answer
    // only — an unreachable registry leaves the install to proceed.
    const deprecated = installBlockReason(pluginName, normalizeDeprecation(meta?.deprecated));
    if (deprecated) throw new PluginDeprecatedError(pluginName, deprecated.detail);
    await linkInstaller.installPlugin(pluginName);
    logger.info(`Successfully installed plugin ${pluginName}`);
    await hooks.aCallAll('pluginInstall', {pluginName});
    cb(null);
  } catch (err) {
    logger.warn(`Failed to install plugin ${pluginName}: ${err}`);
    cb(err);
  }
};

export let availablePlugins:MapArrayType<PackageInfo>|null = null;
let cacheTimestamp = 0;

// The admin plugin page emits `getInstalled` (which checks for updates) and
// `search` at the same time on load, and both end up here. Without sharing
// the in-flight refresh each of them would fetch the feed and sweep npm for
// the whole catalog independently, roughly doubling the work and the page
// latency on a cold cache.
let refreshInFlight: Promise<MapArrayType<PackageInfo>> | null = null;

export const getAvailablePlugins = async (maxCacheAge: number | false) => {
  assertPluginCatalogEnabled();
  const nowTimestamp = Math.round(Date.now() / 1000);

  // check cache age before making any request
  if (availablePlugins && maxCacheAge && (nowTimestamp - cacheTimestamp) <= maxCacheAge) {
    return availablePlugins;
  }

  if (refreshInFlight) return await refreshInFlight;
  refreshInFlight = refreshAvailablePlugins();
  try {
    return await refreshInFlight;
  } finally {
    // Cleared on failure too, so a transient feed outage does not pin every
    // later caller to the same rejected promise.
    refreshInFlight = null;
  }
};

const refreshAvailablePlugins = async (): Promise<MapArrayType<PackageInfo>> => {
  const nowTimestamp = Math.round(Date.now() / 1000);
  const pluginsLoaded = await fetch(`${settings.updateServer}/plugins.json`, {headers});
  if (!pluginsLoaded.ok) {
    throw new Error(`HTTP ${pluginsLoaded.status} ${pluginsLoaded.statusText}`);
  }
  const data = await pluginsLoaded.json() as MapArrayType<PackageInfo>;
  // Normalize: the registry may use numeric keys instead of plugin names
  const normalized: MapArrayType<PackageInfo> = {};
  for (const key in data) {
    const entry = data[key];
    if (entry && entry.name) {
      normalized[entry.name] = entry;
    } else {
      normalized[key] = entry;
    }
  }
  availablePlugins = await hideUninstallablePlugins(normalized);
  cacheTimestamp = nowTimestamp;
  return availablePlugins;
};

/**
 * Drops the feed entries that must not be offered for install: superseded
 * packages, packages npm marks deprecated, and packages the plugin registry
 * itself flagged as not working with current Etherpad (#8246).
 *
 * Fail-open: if the deprecation sweep throws, the feed-only signals are still
 * applied and every other plugin stays listed. Emptying the admin catalog
 * because npm was unreachable would be worse than listing a stale plugin.
 */
const hideUninstallablePlugins = async (
  entries: MapArrayType<PackageInfo>,
): Promise<MapArrayType<PackageInfo>> => {
  const list = Object.values(entries) as unknown as CatalogEntry[];
  let deprecations = new Map<string, string | null>();
  try {
    deprecations = await fetchPluginDeprecations(list);
  } catch (err) {
    logger.warn(`Plugin catalog: could not check npm deprecations (${err}); ` +
                'listing all plugins.');
  }
  const {kept, excluded} = filterCatalogEntries(
      entries as unknown as Record<string, CatalogEntry>, deprecations);
  if (excluded.size > 0) {
    logger.info(`Plugin catalog: hiding ${excluded.size} plugin(s) that cannot be ` +
                'installed safely.');
    for (const [name, exclusion] of excluded) {
      logger.debug(`Plugin catalog: hiding ${name} (${exclusion.cause}): ${exclusion.detail}`);
    }
  }
  return kept as unknown as MapArrayType<PackageInfo>;
};

/**
 * Reasons the given installed plugins should no longer be used, keyed by
 * plugin name. Used by the admin UI to flag an already-installed plugin that
 * has since been deprecated or superseded — the catalog filter only stops
 * *new* installs.
 */
export const getInstalledPluginWarnings = async (
  pkgs: ReadonlyArray<{name: string, version?: string}>,
): Promise<Map<string, string>> => {
  const warnings = new Map<string, string>();
  // ep_etherpad-lite is the core itself, vendored rather than installed from
  // the registry — asking npm about it is pointless and its answer must never
  // put a "deprecated" badge on core.
  pkgs = pkgs.filter((pkg) => pkg && pkg.name && pkg.name !== 'ep_etherpad-lite');
  if (pkgs.length === 0) return warnings;
  let deprecations = new Map<string, string | null>();
  try {
    deprecations = await fetchPluginDeprecations(pkgs);
  } catch (err) {
    logger.warn(`Could not check npm deprecations for installed plugins: ${err}`);
  }
  const entries: Record<string, CatalogEntry> = {};
  for (const pkg of pkgs) if (pkg && pkg.name) entries[pkg.name] = pkg as CatalogEntry;
  const {excluded} = filterCatalogEntries(entries, deprecations);
  for (const [name, exclusion] of excluded) warnings.set(name, exclusion.detail);
  return warnings;
};


export const search = (searchTerm: string, maxCacheAge: number) => getAvailablePlugins(maxCacheAge).then(
    (results: MapArrayType<PackageInfo>) => {
      const res:MapArrayType<PackageData> = {};

      if (searchTerm) {
        searchTerm = searchTerm.toLowerCase();
      }

      for (const pluginName in results) {
        // for every available plugin
        // TODO: Also search in keywords here!
        if (pluginName.indexOf(plugins.prefix) !== 0) continue;

        if (searchTerm && !~results[pluginName].name.toLowerCase().indexOf(searchTerm) &&
            (typeof results[pluginName].description !== 'undefined' &&
                !~results[pluginName].description.toLowerCase().indexOf(searchTerm))
        ) {
          if (typeof results[pluginName].description === 'undefined') {
            logger.debug(`plugin without Description: ${results[pluginName].name}`);
          }

          continue;
        }

        res[pluginName] = results[pluginName];
      }

      return res;
    }
).catch((err)=>{
  logger.error(`Error searching plugins: ${err}`);
  return {} as MapArrayType<PackageInfo>;
});
