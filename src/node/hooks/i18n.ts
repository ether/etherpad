'use strict';

import type {MapArrayType} from "../types/MapType.js";
import {I18nPluginDefs} from "../types/I18nPluginDefs.js";

import languages from 'languages4translatewiki';
import fs from 'fs';
import path from 'path';
import _ from 'underscore';
import pluginDefs from '../../static/js/pluginfw/plugin_defs.js';
import existsSync from '../utils/path_exists.js';
import settings from '../utils/Settings.js';

// returns all existing messages merged together and grouped by langcode
// {es: {"foo": "string"}, en:...}
const getAllLocales = () => {
  const locales2paths:MapArrayType<string[]> = {};

  // Puts the paths of all locale files contained in a given directory
  // into `locales2paths` (files from various dirs are grouped by lang code)
  // (only json files with valid language code as name)
  const extractLangs = (dir: string) => {
    if (!existsSync(dir)) return;
    let stat = fs.lstatSync(dir);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return;

    fs.readdirSync(dir).forEach((file:string) => {
      file = path.resolve(dir, file);
      stat = fs.lstatSync(file);
      if (stat.isDirectory() || stat.isSymbolicLink()) return;

      const ext = path.extname(file);
      const locale = path.basename(file, ext).toLowerCase();

      if ((ext === '.json') && languages.isValid(locale)) {
        if (!locales2paths[locale]) locales2paths[locale] = [];
        locales2paths[locale].push(file);
      }
    });
  };

  // add core supported languages first
  extractLangs(path.join(settings.root, 'src/locales'));

  // add plugins languages (if any)
  for (const {package: {path: pluginPath}} of Object.values<I18nPluginDefs>(pluginDefs.plugins)) {
    // plugin locales should overwrite etherpad's core locales
    if (pluginPath.endsWith('/ep_etherpad-lite')) continue;
    extractLangs(path.join(pluginPath, 'locales'));
  }

  // Build a locale index (merge all locale data other than user-supplied overrides)
  const locales:MapArrayType<any> = {};
  _.each(locales2paths, (files: string[], langcode: string) => {
    locales[langcode] = {};

    files.forEach((file) => {
      let fileContents;
      try {
        fileContents = JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch (err) {
        console.error(`failed to read JSON file ${file}: ${err}`);
        throw err;
      }
      _.extend(locales[langcode], fileContents);
    });
  });

  // Add custom strings from settings.json
  // Since this is user-supplied, we'll do some extra sanity checks
  const wrongFormatErr = Error(
      'customLocaleStrings in wrong format. See documentation ' +
    'for Customization for Administrators, under Localization.');
  if (settings.customLocaleStrings) {
    if (typeof settings.customLocaleStrings !== 'object') throw wrongFormatErr;
    _.each(settings.customLocaleStrings, (overrides , langcode) => {
      if (typeof overrides !== 'object') throw wrongFormatErr;
      _.each(overrides, (localeString:string|object, key:string) => {
        if (typeof localeString !== 'string') throw wrongFormatErr;
        const locale = locales[langcode];

        // Handles the error if an unknown language code is entered
        if (locale === undefined) {
          const possibleMatches = [];
          let strippedLangcode = '';
          if (langcode.includes('-')) {
            strippedLangcode = langcode.split('-')[0];
          }
          for (const localeInEtherPad of Object.keys(locales)) {
            if (localeInEtherPad.includes(strippedLangcode)) {
              possibleMatches.push(localeInEtherPad);
            }
          }
          throw new Error(`Language code ${langcode} is unknown. ` +
              `Maybe you meant: ${possibleMatches}`);
        }

        locales[langcode][key] = localeString;
      });
    });
  }

  return locales;
};

// returns a hash of all available languages availables with nativeName and direction
// e.g. { es: {nativeName: "español", direction: "ltr"}, ... }
const getAvailableLangs = (locales:MapArrayType<any>) => {
  const unsorted:MapArrayType<string> = {};
  for (const langcode of Object.keys(locales)) {
    unsorted[langcode] = languages.getLanguageInfo(langcode);
  }
  // Sort by native name so the language dropdown is alphabetical
  const sorted = Object.entries(unsorted).sort(([, a]: any, [, b]: any) =>
    (a.nativeName || '').localeCompare(b.nativeName || '', undefined, {sensitivity: 'base'})
  );
  const result:MapArrayType<string> = {};
  for (const [langcode, info] of sorted) {
    result[langcode] = info;
  }
  return result;
};

// returns locale index that will be served in /locales.json
const generateLocaleIndex = (locales:MapArrayType<string>) => {
  const result = _.clone(locales); // keep English strings
  for (const langcode of Object.keys(locales)) {
    if (langcode !== 'en') result[langcode] = `locales/${langcode}.json`;
  }
  return JSON.stringify(result);
};


export let availableLangs: any;

export const expressPreSession = async (hookName:string, {app}:any) => {
  // regenerate locales on server restart
  const locales = getAllLocales();
  const localeIndex = generateLocaleIndex(locales);
  exports.availableLangs = availableLangs = getAvailableLangs(locales);

  app.get('/locales/:locale', (req:any, res:any) => {
    // works with /locale/en and /locale/en.json requests
    const locale = req.params.locale.split('.')[0];
    if (Object.prototype.hasOwnProperty.call(exports.availableLangs, locale)) {
      res.setHeader('Cache-Control', `public, max-age=${settings.maxAge}`);
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.send(`{"${locale}":${JSON.stringify(locales[locale])}}`);
    } else {
      res.status(404).send('Language not available');
    }
  });

  app.get('/locales.json', (req: any, res:any) => {
    res.setHeader('Cache-Control', `public, max-age=${settings.maxAge}`);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.send(localeIndex);
  });
};
