// @ts-nocheck
'use strict';

const defs = require('./plugin_defs');

const disabledHookReasons = {
  hooks: {
    indexCustomInlineScripts: 'The hook makes it impossible to use a Content Security Policy ' +
        'that prohibits inline code. Permitting inline code makes XSS vulnerabilities more likely',
  },
};

const loadFn = (path, hookName, modules) => {
  let functionName;
  const parts = path.split(':');

  // on windows: C:\foo\bar:xyz
  if (parts[0].length === 1) {
    if (parts.length === 3) {
      functionName = parts.pop();
    }
    path = parts.join(':');
  } else {
    path = parts[0];
    functionName = parts[1];
  }

  let fn
  if (modules === undefined || !("get" in modules)) {
    fn = require(/* webpackIgnore: true */ path);
  } else {
    fn = modules.get(path);
  }

  functionName = functionName ? functionName : hookName;

  for (const name of functionName.split('.')) {
    fn = fn[name];
  }
  return fn;
};

const extractHooks = (parts, hookSetName, normalizer, modules) => {
  const hooks = {};
  for (const part of parts) {
    for (const [hookName, regHookFnName] of Object.entries(part[hookSetName] || {})) {
      /* On the server side, you can't just
       * require("pluginname/whatever") if the plugin is installed as
       * a dependency of another plugin! Bah, pesky little details of
       * npm... */
      const hookFnName = normalizer ? normalizer(part, regHookFnName, hookName) : regHookFnName;

      const disabledReason = (disabledHookReasons[hookSetName] || {})[hookName];
      if (disabledReason) {
        console.error(`Hook ${hookSetName}/${hookName} is disabled. Reason: ${disabledReason}`);
        console.error(`The hook function ${hookFnName} from plugin ${part.plugin} ` +
                      'will never be called, which may cause the plugin to fail');
        console.error(`Please update the ${part.plugin} plugin to not use the ${hookName} hook`);
        return;
      }
      let hookFn;
      try {
        hookFn = loadFn(hookFnName, hookName, modules);
        if (!hookFn) throw new Error('Not a function');
      } catch (err) {
        console.error(`Failed to load hook function "${hookFnName}" for plugin "${part.plugin}" ` +
                      `part "${part.name}" hook set "${hookSetName}" hook "${hookName}": ` +
                      `${err.stack || err}`);
      }
      if (hookFn) {
        if (hooks[hookName] == null) hooks[hookName] = [];
        hooks[hookName].push({
          hook_name: hookName,
          hook_fn: hookFn,
          hook_fn_name: hookFnName,
          part,
        });
      }
    }
  }
  return hooks;
};

exports.extractHooks = extractHooks;

/*
 * Returns an array containing the names of the installed client-side plugins
 *
 * If no client-side plugins are installed, returns an empty array.
 * Duplicate names are always discarded.
 *
 * A client-side plugin is a plugin that implements at least one client_hook
 *
 * EXAMPLE:
 *   No plugins:   []
 *   Some plugins: [ 'ep_adminpads', 'ep_add_buttons', 'ep_activepads' ]
 */
exports.clientPluginNames = () => {
  const clientPluginNames = defs.parts
      .filter((part) => Object.prototype.hasOwnProperty.call(part, 'client_hooks'))
      .map((part) => `plugin-${part.plugin}`);
  return [...new Set(clientPluginNames)];
};
