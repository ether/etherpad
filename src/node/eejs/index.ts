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
 * require("./index").require("./path/to/template.ejs")
 */

import ejs from 'ejs';
import fs from 'fs';
const hooks = require('../../static/js/pluginfw/hooks');
import path from 'node:path';
// @ts-ignore
import resolve from 'resolve';
import settings from '../utils/Settings';
import {pluginInstallPath} from '../../static/js/pluginfw/installer'

const templateCache = new Map();

exports.info = {
  __output_stack: [],
  block_stack: [],
  file_stack: [],
  args: [],
};

const getCurrentFile = () => exports.info.file_stack[exports.info.file_stack.length - 1];

exports._init = (b: any, recursive: boolean) => {
  exports.info.__output_stack.push(exports.info.__output);
  exports.info.__output = b;
};

exports._exit = (b:any, recursive:boolean) => {
  exports.info.__output = exports.info.__output_stack.pop();
};

exports.begin_block = (name:string) => {
  exports.info.block_stack.push(name);
  exports.info.__output_stack.push(exports.info.__output.get());
  exports.info.__output.set('');
};

exports.end_block = () => {
  const name = exports.info.block_stack.pop();
  const renderContext = exports.info.args[exports.info.args.length - 1];
  const content = exports.info.__output.get();
  exports.info.__output.set(exports.info.__output_stack.pop());
  const args = {content, renderContext};
  hooks.callAll(`eejsBlock_${name}`, args);
  exports.info.__output.set(exports.info.__output.get().concat(args.content));
};

exports.require = (name:string, args:{
  e?: Function,
    require?: Function,
}, mod:{
  filename:string,
    paths:string[],
}) => {
  if (args == null) args = {};

  let basedir = __dirname;
  let paths:string[] = [];

  if (exports.info.file_stack.length) {
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
    paths.push(pluginInstallPath)
  }

  const ejspath = resolve.sync(name, {paths, basedir, extensions: ['.html', '.ejs']});

  args.e = exports;
  args.require = require;

  const cache = settings.maxAge !== 0;
  const template = cache && templateCache.get(ejspath) || ejs.compile(
      '<% e._init({get: () => __output, set: (s) => { __output = s; }}); %>' +
        `${fs.readFileSync(ejspath).toString()}<% e._exit(); %>`,
      {filename: ejspath});
  if (cache) templateCache.set(ejspath, template);

  exports.info.args.push(args);
  exports.info.file_stack.push({path: ejspath});
  const res = template(args);
  exports.info.file_stack.pop();
  exports.info.args.pop();

  return res;
};
