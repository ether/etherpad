/*
 * ACHTUNG: this file is a hack used to load "settings.json.docker" instead of
 *          "settings.json", since in its present form the Settings module does
 *          not allow it.
 *          This is a remnant of an analogous file that was placed in
 *          <basedir>/tests/backend/loadSettings.js
 *
 * TODO: modify the Settings module:
 *       1) no side effects on module load
 *       2) write a factory method that loads a configuration file (taking the
 *          file name from the command line, a function argument, or falling
 *          back to a default)
 */

const fs = require('fs');
const jsonminify = require('jsonminify');

function loadSettings() {
  let settingsStr = fs.readFileSync(`${__dirname}/../../../settings.json.docker`).toString();
  // try to parse the settings
  try {
    if (settingsStr) {
      settingsStr = jsonminify(settingsStr).replace(',]', ']').replace(',}', '}');
      const settings = JSON.parse(settingsStr);

      // custom settings for running in a container
      settings.ip = 'localhost';
      settings.port = '9001';

      return settings;
    }
  } catch (e) {
    console.error('whoops something is bad with settings');
  }
}

exports.loadSettings = loadSettings;
