'use strict';

import log4js from "log4js";

import axios, {AxiosResponse} from "axios";
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

import {findEtherpadRoot} from '../../../node/utils/AbsolutePaths';
const logger = log4js.getLogger('plugins');

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

let tasks = 0;

export const linkInstaller = new LinkInstaller();

const wrapTaskCb = (cb:Function|null) => {
  tasks++;

  return (...args: any) => {
    cb && cb(...args);
    tasks--;
    if (tasks === 0) onAllTasksFinished();
  };
};

const migratePluginsFromNodeModules = async () => {
  logger.info('start migration of plugins in node_modules');
  // Notes:
  //   * Do not pass `--prod` otherwise `npm ls` will fail if there is no `package.json`.
  //   * The `--no-production` flag is required (or the `NODE_ENV` environment variable must be
  //     unset or set to `development`) because otherwise `npm ls` will not mention any packages
  //     that are not included in `package.json` (which is expected to not exist).
  const cmd = ['pnpm', 'ls', '--long', '--json', '--depth=0', '--no-production'];
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
      await linkInstaller.installPlugin(plugin.name, plugin.version);
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

export const install = async (pluginName: string, cb:Function|null = null) => {
  cb = wrapTaskCb(cb);
  logger.info(`Installing plugin ${pluginName}...`);
  await linkInstaller.installPlugin(pluginName);
  logger.info(`Successfully installed plugin ${pluginName}`);
  await hooks.aCallAll('pluginInstall', {pluginName});
  cb(null);
};

export let availablePlugins:MapArrayType<PackageInfo>|null = null;
let cacheTimestamp = 0;

export const getAvailablePlugins = async (maxCacheAge: number | false) => {
  const nowTimestamp = Math.round(Date.now() / 1000);

  // check cache age before making any request
  if (availablePlugins && maxCacheAge && (nowTimestamp - cacheTimestamp) <= maxCacheAge) {
    return availablePlugins;
  }

  const pluginsLoaded: AxiosResponse<MapArrayType<PackageInfo>> = await axios.get(`${settings.updateServer}/plugins.json`, {headers})
  availablePlugins = pluginsLoaded.data;
  cacheTimestamp = nowTimestamp;
  return availablePlugins;
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
