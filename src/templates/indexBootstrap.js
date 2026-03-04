
(async () => {
  window.$ = window.jQuery = require('ep_etherpad-lite/static/js/rjquery').jQuery;
  require('ep_etherpad-lite/static/js/l10n')
  require('ep_etherpad-lite/static/js/index')
  require('ep_etherpad-lite/static/js/welcome')
})()
