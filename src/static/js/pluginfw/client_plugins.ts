// @ts-nocheck
'use strict';

import pluginUtils from './shared.js';
import defs from './plugin_defs.js';

export let baseURL = '';

export const update = async (modules) => {
  const data = await jQuery.getJSON(
    `${baseURL}pluginfw/plugin-definitions.json?v=${clientVars.randomVersionString}`);
  defs.plugins = data.plugins;
  defs.parts = data.parts;
  defs.hooks = pluginUtils.extractHooks(defs.parts, 'client_hooks', null, modules);
  defs.loaded = true;
};

export const ensure = (cb) => !defs.loaded ? update(cb) : cb();

export const adoptPluginsFromAncestorsOf = (frame) => {
  // Bind plugins with parent;
  let parentRequire = null;
  try {
    while ((frame = frame.parent)) {
      if (typeof (frame.require) !== 'undefined') {
        parentRequire = frame.require;
        break;
      }
    }
  } catch (error) {
    // Silence (this can only be a XDomain issue).
    console.error(error);
  }

  if (!parentRequire) throw new Error('Parent plugins could not be found.');

  const ancestorPluginDefs = parentRequire('ep_etherpad-lite/static/js/pluginfw/plugin_defs');
  defs.hooks = ancestorPluginDefs.hooks;
  defs.loaded = ancestorPluginDefs.loaded;
  defs.parts = ancestorPluginDefs.parts;
  defs.plugins = ancestorPluginDefs.plugins;
  const ancestorPlugins = parentRequire('ep_etherpad-lite/static/js/pluginfw/client_plugins');
  baseURL = ancestorPlugins.baseURL;
  // Note: assigning the function bindings of `ensure`/`update` is not possible across ESM module
  // boundaries (named exports are bindings, not mutable variables). The bootstrap re-uses these
  // names directly, so the ancestor's exports are not strictly required to be re-bound here.
};

export default {
  get baseURL() { return baseURL; },
  set baseURL(v: string) { baseURL = v; },
  update,
  ensure,
  adoptPluginsFromAncestorsOf,
};
