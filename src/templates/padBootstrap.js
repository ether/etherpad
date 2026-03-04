
(async () => {

  require('ep_etherpad-lite/static/js/l10n')

  window.clientVars = {
    // This is needed to fetch /pluginfw/plugin-definitions.json, which happens before the server
    // sends the CLIENT_VARS message.
    randomVersionString: <%-JSON.stringify(settings.randomVersionString)%>,
  };

  // Allow other frames to access this frame's modules.
  //window.require.resolveTmp = require.resolve('ep_etherpad-lite/static/js/pad_cookie');

  const basePath = new URL('..', window.location.href).pathname;
  window.$ = window.jQuery = require('ep_etherpad-lite/static/js/rjquery').jQuery;
  window.browser = require('ep_etherpad-lite/static/js/vendors/browser');
  const pad = require('ep_etherpad-lite/static/js/pad');
  pad.baseURL = basePath;
  window.plugins = require('ep_etherpad-lite/static/js/pluginfw/client_plugins');
  const hooks = require('ep_etherpad-lite/static/js/pluginfw/hooks');

  // TODO: These globals shouldn't exist.
  window.pad = pad.pad;
  window.chat = require('ep_etherpad-lite/static/js/chat').chat;
  window.padeditbar = require('ep_etherpad-lite/static/js/pad_editbar').padeditbar;
  window.padimpexp = require('ep_etherpad-lite/static/js/pad_impexp').padimpexp;
  require('ep_etherpad-lite/static/js/skin_variants');
  require('ep_etherpad-lite/static/js/basic_error_handler')

  window.plugins.baseURL = basePath;
  await window.plugins.update(new Map([
    <% for (const module of pluginModules) { %>
    [<%- JSON.stringify(module) %>, require("../../src/plugin_packages/"+<%- JSON.stringify(module) %>)],
    <% } %>
]));
  // Mechanism for tests to register hook functions (install fake plugins).
  window._postPluginUpdateForTestingDone = false;
  if (window._postPluginUpdateForTesting != null) window._postPluginUpdateForTesting();
  window._postPluginUpdateForTestingDone = true;
  window.pluginDefs = require('ep_etherpad-lite/static/js/pluginfw/plugin_defs');
  pad.init();
  await new Promise((resolve) => $(resolve));
  await hooks.aCallAll('documentReady');
})();
