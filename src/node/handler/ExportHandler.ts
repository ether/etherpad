'use strict';
/**
 * Handles the export requests
 */

/*
 * 2011 Peter 'Pita' Martischka (Primary Technology Ltd)
 * 2014 John McLear (Etherpad Foundation / McLear Ltd)
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

const exporthtml = require('../utils/ExportHtml');
const exporttxt = require('../utils/ExportTxt');
const exportEtherpad = require('../utils/ExportEtherpad');
import fs from 'fs';
import settings from '../utils/Settings';
import os from 'os';
const hooks = require('../../static/js/pluginfw/hooks');
import util from 'util';
const { checkValidRev } = require('../utils/checkValidRev');

const fsp_writeFile = util.promisify(fs.writeFile);
const fsp_unlink = util.promisify(fs.unlink);

const tempDirectory = os.tmpdir();

/**
 * do a requested export
 * @param {Object} req the request object
 * @param {Object} res the response object
 * @param {String} padId the pad id to export
 * @param {String} readOnlyId the read only id of the pad to export
 * @param {String} type the type to export
 */
exports.doExport = async (req: any, res: any, padId: string, readOnlyId: string, type:string) => {
  // avoid naming the read-only file as the original pad's id
  let fileName = readOnlyId ? readOnlyId : padId;

  // allow fileName to be overwritten by a hook, the type type is kept static for security reasons
  const hookFileName = await hooks.aCallFirst('exportFileName', padId);

  // if fileName is set then set it to the padId, note that fileName is returned as an array.
  if (hookFileName.length) {
    fileName = hookFileName;
  }

  // tell the browser that this is a downloadable file
  res.attachment(`${fileName}.${type}`);

  if (req.params.rev !== undefined) {
    // ensure revision is a number
    // modify req, as we use it in a later call to exportConvert
    req.params.rev = checkValidRev(req.params.rev);
  }

  // if this is a plain text export, we can do this directly
  // We have to over engineer this because tabs are stored as attributes and not plain text
  if (type === 'etherpad') {
    const pad = await exportEtherpad.getPadRaw(padId, readOnlyId);
    res.send(pad);
  } else if (type === 'txt') {
    const txt = await exporttxt.getPadTXTDocument(padId, req.params.rev);
    res.send(txt);
  } else {
    // render the html document
    let html = await exporthtml.getPadHTMLDocument(padId, req.params.rev, readOnlyId);

    // decide what to do with the html export

    // if this is a html export, we can send this from here directly
    if (type === 'html') {
      // do any final changes the plugin might want to make
      const newHTML = await hooks.aCallFirst('exportHTMLSend', html);
      if (newHTML.length) html = newHTML;
      res.send(html);
      return;
    }

    // else write the html export to a file
    const randNum = Math.floor(Math.random() * 0xFFFFFFFF);
    const srcFile = `${tempDirectory}/etherpad_export_${randNum}.html`;
    await fsp_writeFile(srcFile, html);

    // ensure html can be collected by the garbage collector
    html = null;

    // send the convert job to the converter (abiword, libreoffice, ..)
    const destFile = `${tempDirectory}/etherpad_export_${randNum}.${type}`;

    // Allow plugins to overwrite the convert in export process
    const result = await hooks.aCallAll('exportConvert', {srcFile, destFile, req, res});
    if (result.length > 0) {
      // console.log("export handled by plugin", destFile);
    } else {
      const converter =
          settings.soffice != null ? require('../utils/LibreOffice')
          : settings.abiword != null ? require('../utils/Abiword')
          : null;
      await converter.convertFile(srcFile, destFile, type);
    }

    // send the file
    await res.sendFile(destFile, null);

    // clean up temporary files
    await fsp_unlink(srcFile);

    // 100ms delay to accommodate for slow windows fs
    if (os.type().indexOf('Windows') > -1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    await fsp_unlink(destFile);
  }
};
