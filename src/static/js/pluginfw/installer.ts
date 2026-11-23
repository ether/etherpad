'use strict';

import log4js from "log4js";

import {PackageData, PackageInfo} from "../../../node/types/PackageInfo";
import {MapArrayType} from "../../../node/types/MapType";

import path from "path";
import semver from 'semver';

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
import {
  hasRepositoryField,
  isListedInCatalog,
  isOfficialProvenance,
  isPlaceholderPackage,
  normalizeThirdPartyMode,
  provenanceSource,
} from './pluginTrust';

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
type NpmVersionMeta = {
  engines?: {node?: string},
  deprecated?: unknown,
  repository?: unknown,
  dist?: {integrity?: unknown, attestations?: {url?: unknown}},
};
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

/**
 * Whether the given published version carries npm provenance from a
 * repository in the ether GitHub org (see pluginTrust.ts). Only the
 * registry's own attestations endpoint is consulted; a URL pointing anywhere
 * else is ignored. Returns undefined when the lookup failed, so the caller
 * does not cache a transient failure as "third-party".
 */
const fetchOfficialProvenance = async (
  name: string,
  ref: ProvenanceRef,
  signal: AbortSignal,
): Promise<boolean | undefined> => {
  const {attestationsUrl: url, version, integrity} = ref;
  if (typeof url !== 'string' || typeof version !== 'string') return false;
  if (!url.startsWith(`${npmRegistry}/-/npm/v1/attestations/`)) return false;
  try {
    const res = await fetch(url, {headers, signal});
    if (res.status === 404) return false;
    if (!res.ok) return undefined;
    const source = provenanceSource(await res.json(), {name, version, integrity});
    return isOfficialProvenance(source);
  } catch (err) {
    logger.debug(`npm provenance lookup for ${name}@${version} fell through: ${err}`);
    return undefined;
  }
};

/** What is needed to look up a version's provenance without refetching its metadata. */
type ProvenanceRef = {version?: string, integrity?: unknown, attestationsUrl?: unknown};

/** What the catalog learns about one published version from npm. */
export type PluginRegistryInfo = {
  /** npm deprecation message, or null when not deprecated. */
  deprecated: string | null,
  /** Whether the version's package.json names a repository. */
  hasRepository: boolean,
  /**
   * Built and published from an ether/* repository (npm provenance).
   * `undefined` when provenance was not requested or could not be checked.
   */
  official?: boolean,
};

// Lookups are cached by name@version because a published version is
// immutable apart from its deprecation flag, which changes maybe once in a
// package's lifetime. Without the cache the admin plugin page would hit the
// npm registry once per listed plugin on every catalog refresh. Provenance
// never changes for a published version, so it is cached separately and
// without expiry: the attestation fetch happens once per version.
const DEPRECATION_TTL_MS = 12 * 60 * 60 * 1000;
const DEPRECATION_SWEEP_BUDGET_MS = 15000;
const DEPRECATION_CONCURRENCY = 8;
const DEPRECATION_CACHE_MAX = 1000;
type CachedRegistryInfo = {
  deprecated: string | null,
  hasRepository: boolean,
  provenance: ProvenanceRef,
};
const registryInfoCache = new Map<string, {info: CachedRegistryInfo, expires: number}>();
const provenanceCache = new Map<string, boolean>();
// Lookups that have been started but not finished, so two concurrent sweeps
// (the admin page fires `getInstalled` and `search` together) join one
// request per package instead of issuing two. `undefined` means the lookup
// failed, i.e. the state is unknown.
const registryInfoInFlight = new Map<string, Promise<CachedRegistryInfo | undefined>>();
const provenanceInFlight = new Map<string, Promise<boolean | undefined>>();

// Exported for tests; also lets an operator-triggered catalog reload pick up
// a deprecation published in the last 12 hours.
export const clearDeprecationCache = () => {
  registryInfoCache.clear();
  provenanceCache.clear();
};

/** Runs `fn` over `jobs` with bounded concurrency until done or `signal` aborts. */
const runPool = async <T>(
  jobs: T[], signal: AbortSignal, fn: (job: T) => Promise<void>,
) => {
  let index = 0;
  const worker = async () => {
    while (index < jobs.length) {
      if (signal.aborted) return;
      await fn(jobs[index++]);
    }
  };
  await Promise.all(
    Array.from({length: Math.min(DEPRECATION_CONCURRENCY, jobs.length)}, worker));
};

/**
 * Looks up deprecation and repository for each of the given packages and,
 * with `withProvenance`, whether it is official.
 *
 * The metadata sweep and the provenance sweep each get their own time
 * budget, so a slow registry cannot starve one with the other.
 *
 * Fail-open by design: a package whose metadata lookup fails (offline, npm
 * blocked by a firewall, 404, timeout, overall budget exceeded) is simply
 * absent from the returned map, and the caller then treats it as not
 * deprecated and not a placeholder. An admin behind a firewall gets the full
 * catalog, not an empty one. Provenance that could not be checked is left
 * `undefined` and is never treated as official.
 */
export const fetchPluginRegistryInfo = async (
  pkgs: ReadonlyArray<{name: string, version?: string}>,
  {withProvenance = true}: {withProvenance?: boolean} = {},
): Promise<Map<string, PluginRegistryInfo>> => {
  const cached = new Map<string, CachedRegistryInfo>();
  const pending: Array<{name: string, version: string, key: string}> = [];
  const now = Date.now();
  if (registryInfoCache.size > DEPRECATION_CACHE_MAX) registryInfoCache.clear();
  if (provenanceCache.size > DEPRECATION_CACHE_MAX) provenanceCache.clear();
  for (const pkg of pkgs) {
    if (!pkg || typeof pkg.name !== 'string') continue;
    const version = typeof pkg.version === 'string' && pkg.version ? pkg.version : 'latest';
    const key = `${pkg.name}@${version}`;
    const hit = registryInfoCache.get(key);
    if (hit && hit.expires > now) {
      cached.set(pkg.name, hit.info);
    } else {
      pending.push({name: pkg.name, version, key});
    }
  }

  if (pending.length > 0) {
    // One controller for the whole sweep: if the registry is slow we give up
    // on the remainder rather than making the admin page wait indefinitely.
    const budget = AbortSignal.timeout(DEPRECATION_SWEEP_BUDGET_MS);
    const lookup = (job: {name: string, version: string, key: string}) => {
      const started = registryInfoInFlight.get(job.key);
      if (started) return started;
      const promise = (async (): Promise<CachedRegistryInfo | undefined> => {
        const meta = await fetchPluginVersionMeta(job.name, job.version, budget);
        if (meta === undefined) return undefined; // unknown -> not hidden
        const info: CachedRegistryInfo = {
          deprecated: normalizeDeprecation(meta.deprecated),
          hasRepository: hasRepositoryField(meta.repository),
          provenance: {
            version: typeof (meta as any).version === 'string' ? (meta as any).version : undefined,
            integrity: meta.dist?.integrity,
            attestationsUrl: meta.dist?.attestations?.url,
          },
        };
        registryInfoCache.set(job.key, {info, expires: Date.now() + DEPRECATION_TTL_MS});
        return info;
      })().finally(() => registryInfoInFlight.delete(job.key));
      registryInfoInFlight.set(job.key, promise);
      return promise;
    };
    await runPool(pending, budget, async (job) => {
      const info = await lookup(job);
      if (info !== undefined) cached.set(job.name, info);
    });
    if (budget.aborted && cached.size < pkgs.length) {
      logger.warn('Plugin catalog: npm metadata lookup timed out; ' +
                  'listing the plugins it could not check.');
    }
  }

  const result = new Map<string, PluginRegistryInfo>();
  const needProvenance: Array<{name: string, key: string, ref: ProvenanceRef}> = [];
  for (const [name, info] of cached) {
    const out: PluginRegistryInfo = {deprecated: info.deprecated, hasRepository: info.hasRepository};
    if (withProvenance) {
      const key = `${name}@${info.provenance.version}`;
      const known = provenanceCache.get(key);
      if (known !== undefined) {
        out.official = known;
      } else {
        needProvenance.push({name, key, ref: info.provenance});
      }
    }
    result.set(name, out);
  }

  if (needProvenance.length > 0) {
    const budget = AbortSignal.timeout(DEPRECATION_SWEEP_BUDGET_MS);
    const check = (job: {name: string, key: string, ref: ProvenanceRef}) => {
      const started = provenanceInFlight.get(job.key);
      if (started) return started;
      const promise = (async () => {
        const official = await fetchOfficialProvenance(job.name, job.ref, budget);
        if (official !== undefined) provenanceCache.set(job.key, official);
        return official;
      })().finally(() => provenanceInFlight.delete(job.key));
      provenanceInFlight.set(job.key, promise);
      return promise;
    };
    await runPool(needProvenance, budget, async (job) => {
      const official = await check(job);
      if (official !== undefined) result.get(job.name)!.official = official;
    });
    if (budget.aborted) {
      logger.warn('Plugin catalog: npm provenance lookup timed out; the plugins it ' +
                  'could not check are shown as third-party until the next refresh.');
    }
  }
  return result;
};

/**
 * Looks up the npm deprecation notice for each of the given packages. Same
 * fail-open contract as {@link fetchPluginRegistryInfo}; provenance is not
 * fetched because only the deprecation is needed.
 */
export const fetchPluginDeprecations = async (
  pkgs: ReadonlyArray<{name: string, version?: string}>,
): Promise<Map<string, string | null>> => {
  const info = await fetchPluginRegistryInfo(pkgs, {withProvenance: false});
  return new Map([...info].map(([name, i]) => [name, i.deprecated]));
};

/**
 * Installs a plugin from npm.
 *
 * @param version exact version to install. The admin catalog passes the
 *   version it classified, so an "official" label shown for one release can
 *   never authorise installing a different, newer release. Omitted, the
 *   latest version is installed.
 */
export const install = async (
  pluginName: string, cb:Function|null = null, version?: string,
) => {
  cb = wrapTaskCb(cb);
  logger.info(`Installing plugin ${pluginName}${version ? `@${version}` : ''}...`);
  try {
    if (version !== undefined && !semver.valid(version)) {
      throw new Error(`Invalid version for ${pluginName}: ${version}`);
    }
    // A superseded package is refused before any network call, so the block
    // holds even when npm is unreachable.
    const known = installBlockReason(pluginName);
    if (known) throw new PluginDeprecatedError(pluginName, known.detail);
    const meta = await fetchPluginVersionMeta(pluginName, version);
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
    await linkInstaller.installPlugin(pluginName, version);
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
// Set when the last refresh could not check provenance for some plugins.
// Such a catalog is only reused briefly, so the next search retries instead
// of showing official plugins as third-party for the full cache lifetime.
let catalogIncomplete = false;
const INCOMPLETE_CATALOG_MAX_AGE = 60;

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
  const maxAge = maxCacheAge && catalogIncomplete
    ? Math.min(maxCacheAge, INCOMPLETE_CATALOG_MAX_AGE) : maxCacheAge;
  if (availablePlugins && maxAge && (nowTimestamp - cacheTimestamp) <= maxAge) {
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
  let registryInfo = new Map<string, PluginRegistryInfo>();
  try {
    registryInfo = await fetchPluginRegistryInfo(list);
  } catch (err) {
    logger.warn(`Plugin catalog: could not check npm metadata (${err}); ` +
                'listing all plugins.');
  }
  const deprecations = new Map([...registryInfo].map(([n, i]) => [n, i.deprecated]));
  const {kept, excluded, compatibilityIgnored} = filterCatalogEntries(
      entries as unknown as Record<string, CatalogEntry>, deprecations);
  if (compatibilityIgnored) {
    logger.warn('Plugin catalog: the plugin feed marks most plugins as failing its ' +
                'compatibility check, which points at a broken registry run; ' +
                'ignoring its compatibility verdicts for this refresh.');
  }
  if (excluded.size > 0) {
    logger.info(`Plugin catalog: hiding ${excluded.size} plugin(s) that cannot be ` +
                'installed safely.');
    for (const [name, exclusion] of excluded) {
      logger.debug(`Plugin catalog: hiding ${name} (${exclusion.cause}): ${exclusion.detail}`);
    }
  }
  // Classify what is left. `official` is always overwritten: the feed ships
  // its own `official` flag, which core cannot verify and must not pass on.
  const classified = kept as unknown as MapArrayType<PackageInfo>;
  let official = 0;
  let placeholders = 0;
  let unknown = 0;
  for (const key of Object.keys(classified)) {
    const entry = classified[key];
    if (!entry) continue;
    const info = registryInfo.get(entry.name);
    if (info?.official === undefined) unknown++;
    entry.official = info?.official === true;
    entry.placeholder = !entry.official &&
        isPlaceholderPackage(entry.version, info?.hasRepository);
    if (entry.official) official++;
    if (entry.placeholder) placeholders++;
  }
  catalogIncomplete = unknown > 0;
  logger.info(`Plugin catalog: ${official} official plugin(s), ` +
              `${Object.keys(classified).length - official} third-party ` +
              `(${placeholders} placeholder package(s) listed only on exact-name search).`);
  if (unknown > 0) {
    logger.warn(`Plugin catalog: could not check npm provenance for ${unknown} plugin(s); ` +
                'they are treated as third-party until a later refresh succeeds.');
    if (normalizeThirdPartyMode(settings.pluginCatalogThirdParty) === 'hide') {
      logger.warn('Plugin catalog: pluginCatalogThirdParty is "hide", so plugins whose ' +
                  'provenance could not be checked are not listed. If the catalog is ' +
                  'empty, check that this server can reach registry.npmjs.org.');
    }
  }
  return classified;
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


/**
 * The catalog as the admin may browse it: {@link getAvailablePlugins} with
 * the `pluginCatalogThirdParty` policy applied (no search term, so
 * placeholders are left out in the default mode). The unfiltered catalog is
 * still used internally, e.g. for update checks.
 */
export const getBrowsablePlugins = async (maxCacheAge: number | false) => {
  const all = await getAvailablePlugins(maxCacheAge);
  const mode = normalizeThirdPartyMode(settings.pluginCatalogThirdParty);
  const out: MapArrayType<PackageInfo> = {};
  for (const key of Object.keys(all)) {
    if (all[key] && isListedInCatalog(all[key], mode)) out[key] = all[key];
  }
  return out;
};

export const search = (searchTerm: string, maxCacheAge: number) => getAvailablePlugins(maxCacheAge).then(
    (results: MapArrayType<PackageInfo>) => {
      const res:MapArrayType<PackageData> = {};
      const mode = normalizeThirdPartyMode(settings.pluginCatalogThirdParty);
      const rawTerm = searchTerm || '';

      if (searchTerm) {
        searchTerm = searchTerm.toLowerCase();
      }

      for (const pluginName in results) {
        // for every available plugin
        // TODO: Also search in keywords here!
        if (pluginName.indexOf(plugins.prefix) !== 0) continue;
        // Third-party / placeholder policy (pluginTrust.ts). A placeholder is
        // still found by its exact name so a developer can find the package
        // they just published.
        if (!isListedInCatalog(results[pluginName], mode, rawTerm)) continue;

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
