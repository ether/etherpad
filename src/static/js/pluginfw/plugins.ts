// @ts-nocheck
'use strict';
import {pathToFileURL} from 'node:url';
import {promises as fs} from 'fs';
import log4js from 'log4js';
import path from 'path';
import runCmd from '../../../node/utils/run_cmd.js';
import tsort from './tsort.js';
import pluginUtils from './shared.js';
import defs from './plugin_defs.js';
import hooks from './hooks.js';
import settings, {
  getEpVersion,
} from '../../../node/utils/Settings.js';

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

export const prefix = 'ep_';

export const formatPlugins = () => Object.keys(defs.plugins).join(', ');

export const getPlugins = () => Object.keys(defs.plugins);

export const formatParts = () => defs.parts.map((part) => part.full_name).join('\n');

export const getParts = () => defs.parts.map((part) => part.full_name);

const sortHooks = (hookSetName, hooks) => {
  for (const [pluginName, def] of Object.entries(defs.plugins)) {
    for (const part of (def as any).parts) {
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


export const getHooks = (hookSetName: string, _html?: any) => {
  const hooks = new Map();
  sortHooks(hookSetName, hooks);
  return hooks;
};

export const formatHooks = (hookSetName, html) => {
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

export const pathNormalization = (part, hookFnName, hookName) => {
  const tmp = hookFnName.split(':'); // hookFnName might be something like 'C:\\foo.js:myFunc'.
  // If there is a single colon assume it's 'filename:funcname' not 'C:\\filename'.
  const functionName = (tmp.length > 1 ? tmp.pop() : null) || hookName;
  const moduleName = tmp.join(':') || part.plugin;
  const pkg = defs.plugins[part.plugin].package;
  const packageRoot = pkg.realPath || pkg.path;
  const pluginPrefix = `${part.plugin}/`;
  const relativeModuleName = moduleName.startsWith(pluginPrefix)
    ? moduleName.slice(pluginPrefix.length)
    : moduleName;
  const fileName = path.isAbsolute(relativeModuleName)
    ? relativeModuleName
    : path.join(packageRoot, relativeModuleName);
  return `${fileName}:${functionName}`;
};

const loadServerHook = async (hookFnName, hookName) => {
  const parts = hookFnName.split(':');
  let functionName;
  let modulePath;

  if (parts[0].length === 1) {
    if (parts.length === 3) functionName = parts.pop();
    modulePath = parts.join(':');
  } else {
    modulePath = parts[0];
    functionName = parts[1];
  }

  functionName = functionName || hookName;
  const candidates = path.extname(modulePath) === ''
    ? [`${modulePath}.ts`, `${modulePath}.js`, modulePath]
    : [modulePath];

  let mod;
  let lastErr;
  for (const candidate of candidates) {
    try {
      mod = await import(pathToFileURL(candidate).href);
      break;
    } catch (err) {
      lastErr = err;
    }
  }
  if (mod == null) throw lastErr;

  for (const namespace of [mod, mod.default].filter((ns) => ns != null)) {
    let hookFn = namespace;
    let missing = false;
    for (const name of functionName.split('.')) {
      if (hookFn == null || !(name in hookFn)) {
        missing = true;
        break;
      }
      hookFn = hookFn[name];
    }
    if (!missing) return hookFn;
  }
  return undefined;
};

const extractServerHooks = async (parts) => {
  const hooksByName = {};
  for (const part of parts) {
    for (const [hookName, regHookFnName] of Object.entries(part.hooks || {})) {
      const hookFnName = pathNormalization(part, regHookFnName, hookName);
      try {
        const hookFn = await loadServerHook(hookFnName, hookName);
        if (!hookFn) throw new Error('Not a function');
        if (hooksByName[hookName] == null) hooksByName[hookName] = [];
        hooksByName[hookName].push({
          hook_name: hookName,
          hook_fn: hookFn,
          hook_fn_name: hookFnName,
          part,
        });
      } catch (err) {
        console.error(`Failed to load hook function "${hookFnName}" for plugin "${part.plugin}" ` +
                      `part "${part.name}" hook set "hooks" hook "${hookName}": ` +
                      `${err.stack || err}`);
      }
    }
  }
  return hooksByName;
};

export const update = async () => {
  const packages = await getPackages();
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
  defs.hooks = await extractServerHooks(defs.parts);
  defs.loaded = true;
  await Promise.all(Object.keys(defs.plugins).map(async (p) => {
    const logger = log4js.getLogger(`plugin:${p}`);
    await hooks.aCallAll(`init_${p}`, {logger});
  }));
};

export const getPackages = async () => {
  // Lazily import to avoid a circular dependency between `plugins.ts` and `installer.ts`.
  const {linkInstaller} = await import('./installer.js');
  const plugins = await linkInstaller.listPlugins();
  const newDependencies = {};

  for (const plugin of plugins) {
    if (!plugin.name.startsWith(prefix)) {
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
      const plugin = JSON.parse(data as any);
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

export default {
  prefix,
  formatPlugins,
  getPlugins,
  formatParts,
  getParts,
  getHooks,
  formatHooks,
  pathNormalization,
  update,
  getPackages,
};
