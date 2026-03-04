// @license magnet:?xt=urn:btih:8e4f440f4c65981c5bf93c76d35135ba5064d8b7&dn=apache-2.0.txt
window.clientVars = {
  // This is needed to fetch /pluginfw/plugin-definitions.json, which happens before the
  // server sends the CLIENT_VARS message.
  randomVersionString: <%-JSON.stringify(settings.randomVersionString)%>,
};
let BroadcastSlider;


(function () {
  const timeSlider = require('ep_etherpad-lite/static/js/timeslider')
  const pathComponents = location.pathname.split('/');

  // Strip 'p', the padname and 'timeslider' from the pathname and set as baseURL
  const baseURL = pathComponents.slice(0,pathComponents.length-3).join('/') + '/';
  require('ep_etherpad-lite/static/js/l10n')
  window.$ = window.jQuery = require('ep_etherpad-lite/static/js/rjquery').jQuery; // Expose jQuery #HACK
  require('ep_etherpad-lite/static/js/vendors/gritter')

  window.browser = require('ep_etherpad-lite/static/js/vendors/browser');

  window.plugins = require('ep_etherpad-lite/static/js/pluginfw/client_plugins');
  const socket = timeSlider.socket;
  BroadcastSlider = timeSlider.BroadcastSlider;
  plugins.baseURL = baseURL;
  plugins.update(function () {


    /* TODO: These globals shouldn't exist. */

  });
  const padeditbar = require('ep_etherpad-lite/static/js/pad_editbar').padeditbar;
  const padimpexp = require('ep_etherpad-lite/static/js/pad_impexp').padimpexp;
  timeSlider.baseURL = baseURL;
  timeSlider.init();
  padeditbar.init()
})();
