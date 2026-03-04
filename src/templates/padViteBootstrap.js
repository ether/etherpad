window.$ = window.jQuery = await import('../../src/static/js/rjquery').jQuery;
await import('../../src/static/js/l10n')

window.clientVars = {
  // This is needed to fetch /pluginfw/plugin-definitions.json, which happens before the server
  // sends the CLIENT_VARS message.
  randomVersionString: "7a7bdbad",
};

(async () => {
  // Allow other frames to access this frame's modules.
  //window.require.resolveTmp = require.resolve('ep_etherpad-lite/static/js/pad_cookie');

  const basePath = new URL('..', window.location.href).pathname;
  window.browser = require('../../src/static/js/vendors/browser');
  const pad = require('../../src/static/js/pad');
  pad.baseURL = basePath;
  window.plugins = require('../../src/static/js/pluginfw/client_plugins');
  const hooks = require('../../src/static/js/pluginfw/hooks');

  // TODO: These globals shouldn't exist.
  window.pad = pad.pad;
  window.chat = require('../../src/static/js/chat').chat;
  window.padeditbar = require('../../src/static/js/pad_editbar').padeditbar;
  window.padimpexp = require('../../src/static/js/pad_impexp').padimpexp;
  require('../../src/static/js/skin_variants');
  require('../../src/static/js/basic_error_handler')

  window.plugins.baseURL = basePath;
  await window.plugins.update(new Map([

  ]));
  // Mechanism for tests to register hook functions (install fake plugins).
  window._postPluginUpdateForTestingDone = false;
  if (window._postPluginUpdateForTesting != null) window._postPluginUpdateForTesting();
  window._postPluginUpdateForTestingDone = true;
  window.pluginDefs = require('../../src/static/js/pluginfw/plugin_defs');
  pad.init();
  await new Promise((resolve) => $(resolve));
  await hooks.aCallAll('documentReady');
})();
