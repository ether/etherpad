// @ts-nocheck
'use strict';

const fs = require('fs').promises;
const hooks = require('./hooks');
const log4js = require('log4js');
const path = require('path');
const runCmd = require('../../../node/utils/run_cmd');
const tsort = require('./tsort');
const pluginUtils = require('./shared');
const defs = require('./plugin_defs');
import settings, {
  getEpVersion,
} from '../../../node/utils/Settings';

const logger = log4js.getLogger('plugins');

// Log the version of npm at startup.
(async () => {
  try {
    const version = await runCmd(['pnpm', '--version'], {stdio: [null, 'string']});
    logger.info(`pnpm --version: ${version}`);
  } catch (err) {
    logger.error(`Failed to get pnpm version: ${err.stack || err}`);
    // This isn't a fatal error so don't re-throw.
  }
})();

exports.prefix = 'ep_';

exports.formatPlugins = () => Object.keys(defs.plugins).join(', ');

exports.getPlugins = () => Object.keys(defs.plugins);

exports.formatParts = () => defs.parts.map((part) => part.full_name).join('\n');

exports.getParts = () => defs.parts.map((part) => part.full_name);

const sortHooks = (hookSetName, hooks) => {
  for (const [pluginName, def] of Object.entries(defs.plugins)) {
    for (const part of def.parts) {
      for (const [hookName, hookFnName] of Object.entries(part[hookSetName] || {})) {
        let hookEntry = hooks.get(hookName);
        if (!hookEntry) {
          hookEntry = new Map();
          hooks.set(hookName, hookEntry);
        }
        let pluginEntry = hookEntry.get(pluginName);
        if (!pluginEntry) {
          pluginEntry = new Map();
          hookEntry.set(pluginName, pluginEntry);
        }
        pluginEntry.set(part.name, hookFnName);
      }
    }
  }
};


exports.getHooks = (hookSetName) => {
  const hooks = new Map();
  sortHooks(hookSetName, hooks);
  return hooks;
};

exports.formatHooks = (hookSetName, html) => {
  let hooks = new Map();
  sortHooks(hookSetName, hooks);
  const lines = [];
  const sortStringKeys = (a, b) => String(a[0]).localeCompare(b[0]);
  if (html) lines.push('<dl>');
  hooks = new Map([...hooks].sort(sortStringKeys));
  for (const [hookName, hookEntry] of hooks) {
    lines.push(html ? `  <dt>${hookName}:</dt><dd><dl>` : `  ${hookName}:`);
    const sortedHookEntry = new Map([...hookEntry].sort(sortStringKeys));
    hooks.set(hookName, sortedHookEntry);
    for (const [pluginName, pluginEntry] of sortedHookEntry) {
      lines.push(html ? `    <dt>${pluginName}:</dt><dd><dl>` : `    ${pluginName}:`);
      const sortedPluginEntry = new Map([...pluginEntry].sort(sortStringKeys));
      sortedHookEntry.set(pluginName, sortedPluginEntry);
      for (const [partName, hookFnName] of sortedPluginEntry) {
        lines.push(html
          ? `      <dt>${partName}:</dt><dd>${hookFnName}</dd>`
          : `      ${partName}: ${hookFnName}`);
      }
      if (html) lines.push('    </dl></dd>');
    }
    if (html) lines.push('  </dl></dd>');
  }
  if (html) lines.push('</dl>');
  return lines.join('\n');
};

exports.pathNormalization = (part, hookFnName, hookName) => {
  const tmp = hookFnName.split(':'); // hookFnName might be something like 'C:\\foo.js:myFunc'.
  // If there is a single colon assume it's 'filename:funcname' not 'C:\\filename'.
  const functionName = (tmp.length > 1 ? tmp.pop() : null) || hookName;
  const moduleName = tmp.join(':') || part.plugin;
  const packageDir = path.dirname(defs.plugins[part.plugin].package.path);
  const fileName = path.join(packageDir, moduleName);
  return `${fileName}:${functionName}`;
};

exports.update = async () => {
  const packages = await exports.getPackages();
  const parts = {}; // Key is full name. sortParts converts this into a topologically sorted array.
  const plugins = {};

  // Load plugin metadata ep.json
  await Promise.all(Object.keys(packages).map(async (pluginName) => {
    logger.info(`Loading plugin ${pluginName}...`);
    await loadPlugin(packages, pluginName, plugins, parts);
  }));
  logger.info(`Loaded ${Object.keys(packages).length} plugins`);

  defs.plugins = plugins;
  defs.parts = sortParts(parts);
  defs.hooks = pluginUtils.extractHooks(defs.parts, 'hooks', exports.pathNormalization);
  defs.loaded = true;
  await Promise.all(Object.keys(defs.plugins).map(async (p) => {
    const logger = log4js.getLogger(`plugin:${p}`);
    await hooks.aCallAll(`init_${p}`, {logger});
  }));
};

exports.getPackages = async () => {
  const {linkInstaller} = require("./installer");
  const plugins = await linkInstaller.listPlugins();
  const newDependencies = {};

  for (const plugin of plugins) {
    if (!plugin.name.startsWith(exports.prefix)) {
      continue;
    }
    plugin.path = plugin.realPath = plugin.location;
    newDependencies[plugin.name] = plugin;
  }

  newDependencies['ep_etherpad-lite'] = {
    name: 'ep_etherpad-lite',
    version: getEpVersion(),
    path: path.join(settings.root, 'node_modules/ep_etherpad-lite'),
    realPath: path.join(settings.root, 'src'),
  };

  return newDependencies;
};

const loadPlugin = async (packages, pluginName, plugins, parts) => {
  const pluginPath = path.resolve(packages[pluginName].path, 'ep.json');
  try {
    const data = await fs.readFile(pluginPath);
    try {
      const plugin = JSON.parse(data);
      plugin.package = packages[pluginName];
      plugins[pluginName] = plugin;
      for (const part of plugin.parts) {
        part.plugin = pluginName;
        part.full_name = `${pluginName}/${part.name}`;
        parts[part.full_name] = part;
      }
    } catch (err) {
      logger.error(`Unable to parse plugin definition file ${pluginPath}: ${err.stack || err}`);
    }
  } catch (err) {
    logger.error(`Unable to load plugin definition file ${pluginPath}: ${err.stack || err}`);
  }
};

const partsToParentChildList = (parts) => {
  const res = [];
  for (const name of Object.keys(parts)) {
    for (const childName of parts[name].post || []) {
      res.push([name, childName]);
    }
    for (const parentName of parts[name].pre || []) {
      res.push([parentName, name]);
    }
    if (!parts[name].pre && !parts[name].post) {
      res.push([name, `:${name}`]); // Include apps with no dependency info
    }
  }
  return res;
};

// Used only in Node, so no need for _
const sortParts = (parts) => tsort(partsToParentChildList(parts))
    .filter((name) => parts[name] !== undefined)
    .map((name) => parts[name]);
