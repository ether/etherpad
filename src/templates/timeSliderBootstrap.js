// @license magnet:?xt=urn:btih:8e4f440f4c65981c5bf93c76d35135ba5064d8b7&dn=apache-2.0.txt
window.clientVars = {
  // This is needed to fetch /pluginfw/plugin-definitions.json, which happens before the
  // server sends the CLIENT_VARS message.
  randomVersionString: <%-JSON.stringify(settings.randomVersionString)%>,
  cookiePrefix: <%-JSON.stringify(settings.cookie.prefix)%>,
};
let BroadcastSlider;


(async function () {
  const timeSlider = require('ep_etherpad-lite/static/js/timeslider')
  const pathComponents = location.pathname.split('/');

  // Strip 'p', the padname and 'timeslider' from the pathname and set as baseURL
  const baseURL = pathComponents.slice(0,pathComponents.length-3).join('/') + '/';
  require('ep_etherpad-lite/static/js/l10n')
  window.$ = window.jQuery = require('ep_etherpad-lite/static/js/rjquery').jQuery; // Expose jQuery #HACK
  require('ep_etherpad-lite/static/js/vendors/gritter')

  window.browser = require('ep_etherpad-lite/static/js/vendors/browser');

  const clientPlugins = require('ep_etherpad-lite/static/js/pluginfw/client_plugins');
  window.plugins = clientPlugins.default || clientPlugins;
  const socket = timeSlider.socket;
  BroadcastSlider = timeSlider.BroadcastSlider;
  plugins.baseURL = baseURL;
  // Pre-load plugin modules so client_hooks resolve (issue #7659): without
  // a populated Map the loadFn fallback calls require(path) which the
  // esbuild-bundled timeslider can't resolve at runtime, so plugins like
  // ep_headings2 silently fail to register their aceRegisterBlockElements
  // hook and historical revisions render without plugin chrome. Mirrors
  // padBootstrap.js — same pluginModules list, same per-module require.
  await plugins.update(new Map([
    <% for (const module of pluginModules) { %>
    [<%- JSON.stringify(module) %>, require("../../src/plugin_packages/"+<%- JSON.stringify(module) %>)],
    <% } %>
  ]));
  const padeditbar = require('ep_etherpad-lite/static/js/pad_editbar').padeditbar;
  const padimpexp = require('ep_etherpad-lite/static/js/pad_impexp').padimpexp;
  if (typeof timeSlider.setBaseURL === 'function') timeSlider.setBaseURL(baseURL);
  timeSlider.init();
  padeditbar.init()
})();
