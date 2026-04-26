'use strict';
/*
 * Copyright (c) 2011 RedHog (Egil Möller) <egil.moller@freecode.no>
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS-IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/* Basic usage:
 *
 * import eejs from './index.js';
 * eejs.require("./path/to/template.ejs")
 */

import ejs from 'ejs';
import fs from 'fs';
import hooks from '../../static/js/pluginfw/hooks.js';
import * as i18n from '../hooks/i18n.js';
import path from 'node:path';
// @ts-ignore
import resolve from 'resolve';
import settings from '../utils/Settings.js';
import { pluginInstallPath } from '../../static/js/pluginfw/installer.js';
import pluginUtils from '../../static/js/pluginfw/shared.js';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { createRequire } from 'node:module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const requireFromHere = createRequire(import.meta.url);
const templateModules = new Map<string, any>([
  ['ep_etherpad-lite/node/hooks/i18n', i18n],
  ['ep_etherpad-lite/static/js/pluginfw/shared', pluginUtils],
]);

const templateCache = new Map();

interface EejsInfo {
  __output_stack: any[];
  __output?: any;
  block_stack: string[];
  file_stack: { path: string }[];
  args: any[];
}

const eejs: any = {
  info: {
    __output_stack: [],
    block_stack: [],
    file_stack: [],
    args: [],
  } as EejsInfo,
};

const getCurrentFile = () => eejs.info.file_stack[eejs.info.file_stack.length - 1];

eejs._init = (b: any, _recursive: boolean) => {
  eejs.info.__output_stack.push(eejs.info.__output);
  eejs.info.__output = b;
};

eejs._exit = (_b: any, _recursive: boolean) => {
  eejs.info.__output = eejs.info.__output_stack.pop();
};

eejs.begin_block = (name: string) => {
  eejs.info.block_stack.push(name);
  eejs.info.__output_stack.push(eejs.info.__output.get());
  eejs.info.__output.set('');
};

eejs.end_block = () => {
  const name = eejs.info.block_stack.pop();
  const renderContext = eejs.info.args[eejs.info.args.length - 1];
  const content = eejs.info.__output.get();
  eejs.info.__output.set(eejs.info.__output_stack.pop());
  const args = { content, renderContext };
  hooks.callAll(`eejsBlock_${name}`, args);
  eejs.info.__output.set(eejs.info.__output.get().concat(args.content));
};

eejs.require = (
  name: string,
  args: { e?: any; require?: Function },
  mod: { filename: string; paths: string[] }
) => {
  if (args == null) args = {};

  let basedir = __dirname;
  let paths: string[] = [];

  if (eejs.info.file_stack.length) {
    basedir = path.dirname(getCurrentFile().path);
  }
  if (mod) {
    basedir = path.dirname(mod.filename);
    paths = mod.paths;
  }

  /**
   * Add the plugin install path to the paths array
   */
  if (!paths.includes(pluginInstallPath)) {
    paths.push(pluginInstallPath);
  }

  const ejspath = resolve.sync(name, { paths, basedir, extensions: ['.html', '.ejs'] });

  args.e = eejs;
  args.require = (name: string) => templateModules.get(name) ?? requireFromHere(name);

  const cache = settings.maxAge !== 0;
  const template =
    (cache && templateCache.get(ejspath)) ||
    ejs.compile(
      '<% e._init({get: () => __output, set: (s) => { __output = s; }}); %>' +
        `${fs.readFileSync(ejspath).toString()}<% e._exit(); %>`,
      { filename: ejspath }
    );
  if (cache) templateCache.set(ejspath, template);

  eejs.info.args.push(args);
  eejs.info.file_stack.push({ path: ejspath });
  const res = template(args);
  eejs.info.file_stack.pop();
  eejs.info.args.pop();

  return res;
};

export default eejs;
