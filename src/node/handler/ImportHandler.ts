'use strict';
/**
 * Handles the import requests
 */

/*
 * 2011 Peter 'Pita' Martischka (Primary Technology Ltd)
 * 2012 Iván Eixarch
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

const padManager = require('../db/PadManager');
const padMessageHandler = require('./PadMessageHandler');
import {promises as fs} from 'fs';
import path from 'path';
import settings from '../utils/Settings';
const {Formidable} = require('formidable');
import os from 'os';
const importHtml = require('../utils/ImportHtml');
const importEtherpad = require('../utils/ImportEtherpad');
import log4js from 'log4js';
const hooks = require('../../static/js/pluginfw/hooks');

const logger = log4js.getLogger('ImportHandler');

// `status` must be a string supported by `importErrorMessage()` in `src/static/js/pad_impexp.js`.
class ImportError extends Error {
  status: string;
  constructor(status: string, ...args:any) {
    super(...args);
    if (Error.captureStackTrace) Error.captureStackTrace(this, ImportError);
    this.name = 'ImportError';
    this.status = status;
    const msg = this.message == null ? '' : String(this.message);
    if (status !== '') this.message = msg === '' ? status : `${status}: ${msg}`;
  }
}

const rm = async (path: string) => {
  try {
    await fs.unlink(path);
  } catch (err:any) {
    if (err.code !== 'ENOENT') throw err;
  }
};

let converter:any = null;
let exportExtension = 'htm';

// load abiword only if it is enabled and if soffice is disabled
if (settings.abiword != null && settings.soffice == null) {
  converter = require('../utils/Abiword');
}

// load soffice only if it is enabled
if (settings.soffice != null) {
  converter = require('../utils/LibreOffice');
  exportExtension = 'html';
}

const tmpDirectory = os.tmpdir();

/**
 * do a requested import
 * @param {Object} req the request object
 * @param {Object} res the response object
 * @param {String} padId the pad id to export
 * @param {String} authorId the author id to use for the import
 */
const doImport = async (req:any, res:any, padId:string, authorId:string) => {
  // pipe to a file
  // convert file to html via abiword or soffice
  // set html in the pad
  const randNum = Math.floor(Math.random() * 0xFFFFFFFF);

  // setting flag for whether to use converter or not
  let useConverter = (converter != null);

  const form = new Formidable({
    keepExtensions: true,
    uploadDir: tmpDirectory,
    maxFileSize: settings.importMaxFileSize,
  });

  let srcFile;
  let files;
  let fields;
  try {
    [fields, files] = await form.parse(req);
  } catch (err:any) {
    logger.warn(`Import failed due to form error: ${err.stack || err}`);
    if (err.code === Formidable.formidableErrors.biggerThanMaxFileSize) {
      throw new ImportError('maxFileSize');
    }
    throw new ImportError('uploadFailed');
  }
  if (!files.file) {
    logger.warn('Import failed because form had no file');
    throw new ImportError('uploadFailed');
  } else {
    srcFile = files.file[0].filepath;
  }

  // ensure this is a file ending we know, else we change the file ending to .txt
  // this allows us to accept source code files like .c or .java
  const fileEnding = path.extname(files.file[0].originalFilename).toLowerCase();
  const knownFileEndings =
    ['.txt', '.doc', '.docx', '.pdf', '.odt', '.html', '.htm', '.etherpad', '.rtf'];
  const fileEndingUnknown = (knownFileEndings.indexOf(fileEnding) < 0);

  if (fileEndingUnknown) {
    // the file ending is not known

    if (settings.allowUnknownFileEnds === true) {
      // we need to rename this file with a .txt ending
      const oldSrcFile = srcFile;

      srcFile = path.join(path.dirname(srcFile), `${path.basename(srcFile, fileEnding)}.txt`);
      await fs.rename(oldSrcFile, srcFile);
    } else {
      logger.warn(`Not allowing unknown file type to be imported: ${fileEnding}`);
      throw new ImportError('uploadFailed');
    }
  }

  const destFile = path.join(tmpDirectory, `etherpad_import_${randNum}.${exportExtension}`);
  const context = {srcFile, destFile, fileEnding, padId, ImportError};
  const importHandledByPlugin = (await hooks.aCallAll('import', context)).some((x:string) => x);
  const fileIsEtherpad = (fileEnding === '.etherpad');
  const fileIsHTML = (fileEnding === '.html' || fileEnding === '.htm');
  const fileIsTXT = (fileEnding === '.txt');

  let directDatabaseAccess = false;
  if (fileIsEtherpad) {
    // Use '\n' to avoid the default pad text if the pad doesn't yet exist.
    const pad = await padManager.getPad(padId, '\n', authorId);
    const headCount = pad.head;
    if (headCount >= 10) {
      logger.warn('Aborting direct database import attempt of a pad that already has content');
      throw new ImportError('padHasData');
    }
    const text = await fs.readFile(srcFile, 'utf8');
    directDatabaseAccess = true;
    await importEtherpad.setPadRaw(padId, text, authorId);
  }

  // convert file to html if necessary
  if (!importHandledByPlugin && !directDatabaseAccess) {
    if (fileIsTXT) {
      // Don't use converter for text files
      useConverter = false;
    }

    // See https://github.com/ether/etherpad-lite/issues/2572
    if (fileIsHTML || !useConverter) {
      // if no converter only rename
      await fs.rename(srcFile, destFile);
    } else {
      try {
        await converter.convertFile(srcFile, destFile, exportExtension);
      } catch (err:any) {
        logger.warn(`Converting Error: ${err.stack || err}`);
        throw new ImportError('convertFailed');
      }
    }
  }

  if (!useConverter && !directDatabaseAccess) {
    // Read the file with no encoding for raw buffer access.
    const buf = await fs.readFile(destFile);

    // Check if there are only ascii chars in the uploaded file
    const isAscii = !Array.prototype.some.call(buf, (c) => (c > 240));

    if (!isAscii) {
      logger.warn('Attempt to import non-ASCII file');
      throw new ImportError('uploadFailed');
    }
  }

  // Use '\n' to avoid the default pad text if the pad doesn't yet exist.
  let pad = await padManager.getPad(padId, '\n', authorId);

  // read the text
  let text;

  if (!directDatabaseAccess) {
    text = await fs.readFile(destFile, 'utf8');

    // node on windows has a delay on releasing of the file lock.
    // We add a 100ms delay to work around this
    if (os.type().indexOf('Windows') > -1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  // change text of the pad and broadcast the changeset
  if (!directDatabaseAccess) {
    if (importHandledByPlugin || useConverter || fileIsHTML) {
      try {
        await importHtml.setPadHTML(pad, text, authorId);
      } catch (err:any) {
        logger.warn(`Error importing, possibly caused by malformed HTML: ${err.stack || err}`);
      }
    } else {
      await pad.setText(text, authorId);
    }
  }

  // Load the Pad into memory then broadcast updates to all clients
  padManager.unloadPad(padId);
  pad = await padManager.getPad(padId, '\n', authorId);
  padManager.unloadPad(padId);

  // Direct database access means a pad user should reload the pad and not attempt to receive
  // updated pad data.
  if (directDatabaseAccess) return true;

  // tell clients to update
  await padMessageHandler.updatePadClients(pad);

  // clean up temporary files
  rm(srcFile);
  rm(destFile);

  return false;
};

/**
 * Handles the request to import a file
 * @param {Request} req the request object
 * @param {Response} res the response object
 * @param {String} padId the pad id to export
 * @param {String} authorId the author id to use for the import
 * @return {Promise<void>} a promise
 */
exports.doImport = async (req:any, res:any, padId:string, authorId:string = '') => {
  let httpStatus = 200;
  let code = 0;
  let message = 'ok';
  let directDatabaseAccess;
  try {
    directDatabaseAccess = await doImport(req, res, padId, authorId);
  } catch (err:any) {
    const known = err instanceof ImportError && err.status;
    if (!known) logger.error(`Internal error during import: ${err.stack || err}`);
    httpStatus = known ? 400 : 500;
    code = known ? 1 : 2;
    message = known ? err.status : 'internalError';
  }
  res.status(httpStatus).json({code, message, data: {directDatabaseAccess}});
};
