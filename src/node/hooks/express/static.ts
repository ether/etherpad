'use strict';

import {MapArrayType} from "../../types/MapType";
import {PartType} from "../../types/PartType";

const fs = require('fs').promises;
import {minify} from '../../utils/Minify';
import path from 'node:path';
import {ArgsExpressType} from "../../types/ArgsExpressType";
const plugins = require('../../../static/js/pluginfw/plugin_defs');
import settings from '../../utils/Settings';

// Rewrite tar to include modules with no extensions and proper rooted paths.
const getTar = async () => {
  const prefixLocalLibraryPath = (path:string) => {
    if (path.charAt(0) === '$') {
      return path.slice(1);
    } else {
      return `ep_etherpad-lite/static/js/${path}`;
    }
  };

  const tarJson = await fs.readFile(path.join(settings.root, 'src/node/utils/tar.json'), 'utf8');
  const tar:MapArrayType<string[]> = {};
  for (const [key, relativeFiles] of Object.entries(JSON.parse(tarJson)) as [string, string[]][]) {
    const files = relativeFiles.map(prefixLocalLibraryPath);
    tar[prefixLocalLibraryPath(key)] = files
        .concat(files.map((p) => p.replace(/\.js$/, '')))
        .concat(files.map((p) => `${p.replace(/\.js$/, '')}/index.js`));
  }
  return tar;
};

exports.expressPreSession = async (hookName:string, {app}:ArgsExpressType) => {

  // Minify will serve static files compressed (minify enabled). It also has
  // file-specific hacks for ace/require-kernel/etc.
  app.all('/static/*filename', minify);

  // serve plugin definitions
  // not very static, but served here so that client can do
  // require("pluginfw/static/js/plugin-definitions.js");
  app.get('/pluginfw/plugin-definitions.json', (_req, res) => {
    const clientParts = plugins.parts.filter((part: PartType) => part.client_hooks != null);
    const clientPlugins:MapArrayType<string> = {};
    for (const name of new Set(clientParts.map((part: PartType) => part.plugin))) {
      // @ts-ignore
      clientPlugins[name] = {...plugins.plugins[name]};
      // @ts-ignore
      delete clientPlugins[name].package;
    }
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', `public, max-age=${settings.maxAge}`);
    res.write(JSON.stringify({plugins: clientPlugins, parts: clientParts}));
    res.end();
  });
};
