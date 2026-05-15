'use strict';

// Each of these require()s would throw MODULE_NOT_FOUND if
// /opt/etherpad/src/plugin_packages were symlinked outside the etherpad
// tree -- Node resolves the symlink to its realpath before walking
// node_modules and never reaches the bundled ep_etherpad-lite under
// /opt/etherpad/node_modules. See ether/ep_comments_page#416.
const eejs = require('ep_etherpad-lite/node/eejs/');
const settings = require('ep_etherpad-lite/node/utils/Settings');
const log4js = require('ep_etherpad-lite/node_modules/log4js');
const {randomString} = require('ep_etherpad-lite/static/js/pad_utils');

const logger = log4js.getLogger('ep_layout_trip_wire');

// CI greps the journal for this exact line.
const MARKER = 'ep_layout_trip_wire: plugin_packages layout OK';

exports.expressCreateServer = (hookName, ctx, cb) => {
  // Touch each binding so a future "require but never use" lint can't
  // dead-code-eliminate them and silently weaken the test.
  void eejs.require;
  void settings.title;
  void randomString;
  logger.info(MARKER);
  return cb();
};
