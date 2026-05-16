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

import * as padManager from '../db/PadManager.js';
import padMessageHandler from './PadMessageHandler.js';
import {promises as fs} from 'fs';
import path from 'path';
import settings from '../utils/Settings.js';
import { Formidable } from 'formidable';
import os from 'os';
import * as importHtml from '../utils/ImportHtml.js';
import * as importEtherpad from '../utils/ImportEtherpad.js';
import * as ImportDocxNative from '../utils/ImportDocxNative.js';
import * as ExportSanitizeHtml from '../utils/ExportSanitizeHtml.js';
import log4js from 'log4js';
import hooks from '../../static/js/pluginfw/hooks.js';
import * as converterModule from '../utils/LibreOffice.js';

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

let converter: typeof converterModule | null = null;
let exportExtension = 'htm';

// load soffice only if it is enabled
if (settings.soffice != null) {
  converter = converterModule;
  exportExtension = 'html';
}

// Office formats with no in-process import path (issue #7538). When soffice
// is null these are rejected explicitly so users see a clear error instead
// of a silent ASCII-only fallback. .docx has a native path via mammoth.
const SOFFICE_ONLY_IMPORT_FORMATS = new Set(['.pdf', '.odt', '.doc', '.rtf']);

const tmpDirectory = os.tmpdir();

/**
 * do a requested import
 * @param {Object} req the request object
 * @param {Object} res the response object
 * @param {String} padId the pad id to export
 * @param {String} authorId the author id to use for the import
 */
const performImport = async (req:any, res:any, padId:string, authorId:string) => {
  // pipe to a file
  // convert file to html via soffice
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
    if (err.code === (Formidable as any).formidableErrors.biggerThanMaxFileSize) {
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
  const fileEnding = path.extname(files.file[0].originalFilename || '').toLowerCase();
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

  // Detect once whether the contentcollector treats h1-h6/code as block
  // elements server-side. ep_headings2 v0.2.118+ (after the
  // ep_plugin_helpers ccRegisterBlockElements wiring lands) registers
  // them; older versions don't. The two preprocessors below are only
  // needed when the plugin hook is missing — they're harmful otherwise
  // (each adds an extra blank pad line per heading transition).
  const ccBlockElems: string[] =
      ([] as string[]).concat(...(hooks.callAll('ccRegisterBlockElements') || []));
  const ccBlockSet = new Set(ccBlockElems.map((t: string) => t.toLowerCase()));
  // ep_headings2 registers 'h1' along with the others when its server
  // hook is wired (ccRegisterBlockElements). h1 is sufficient as the
  // detection probe; the absence of h5/h6 in the set is a quirk of
  // ep_headings2 (it only handles h1-h4) and not a sign of a broken
  // hook.
  const headingsAreBlocks = ccBlockSet.has('h1');

  // Native DOCX import (issue #7538): when soffice isn't configured we
  // hand .docx files to mammoth, which produces HTML — then we feed that
  // through the existing setPadHTML pipeline.
  if (settings.soffice == null && fileEnding === '.docx') {
    const buf = await fs.readFile(srcFile);
    const {docxBufferToHtml} = ImportDocxNative;
    const {separateAdjacentHeadingBlocks} = ExportSanitizeHtml;
    let nativeHtml: string;
    try {
      nativeHtml = await docxBufferToHtml(buf);
      // When the plugin hook is missing, contentcollector treats h1-h6
      // as inline and adjacent headings merge into a single pad line.
      // Insert <br> between them as a defensive workaround. Skipped when
      // the plugin already registers the tags (otherwise the <br> becomes
      // an extra blank line per heading transition).
      if (!headingsAreBlocks) {
        nativeHtml = separateAdjacentHeadingBlocks(nativeHtml);
      }
    } catch (err: any) {
      logger.warn(`Native DOCX import failed: ${err.stack || err}`);
      throw new ImportError('convertFailed');
    }
    const pad = await padManager.getPad(padId, '\n', authorId);
    try {
      await importHtml.setPadHTML(pad, nativeHtml, authorId);
    } catch (err: any) {
      logger.warn(`Error importing native DOCX HTML: ${err.stack || err}`);
      throw new ImportError('convertFailed');
    }
    padManager.unloadPad(padId);
    const reloaded = await padManager.getPad(padId, '\n', authorId);
    padManager.unloadPad(padId);
    await padMessageHandler.updatePadClients(reloaded);
    rm(srcFile);
    return false;
  }

  // Without soffice, the legacy office formats (pdf, odt, doc, rtf) have
  // no in-process path. Reject explicitly so the user sees a clear error
  // instead of a silent ASCII-only fallback.
  if (settings.soffice == null && SOFFICE_ONLY_IMPORT_FORMATS.has(fileEnding)) {
    logger.warn(`Cannot import ${fileEnding} without soffice configured`);
    throw new ImportError('uploadFailed');
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
        await converter!.convertFile(srcFile, destFile, exportExtension);
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
  let text: string = '';

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
        // Etherpad's HTML export wraps each pad line in `<p>...</p>`
        // (or `<h1>`, `<code>`, etc.) and then appends a `<br>` between
        // lines. The closing block tag already ends the line for
        // contentcollector, so the trailing `<br>` is redundant and
        // doubles every blank line on import. Collapse `</block><br>`
        // before handing to setPadHTML so HTML round-trips don't drift.
        // Only applied to HTML imports (and converted-via-soffice
        // outputs, which look the same shape) -- the docx native path
        // above doesn't go through here.
        const {collapseRedundantBrAfterBlocks} = ExportSanitizeHtml;
        const cleaned = (fileIsHTML || useConverter)
            ? collapseRedundantBrAfterBlocks(text) : text;
        await importHtml.setPadHTML(pad, cleaned, authorId);
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
export const doImport = async (req:any, res:any, padId:string, authorId:string = '') => {
  let httpStatus = 200;
  let code = 0;
  let message = 'ok';
  let directDatabaseAccess;
  try {
    directDatabaseAccess = await performImport(req, res, padId, authorId);
  } catch (err:any) {
    const known = err instanceof ImportError && err.status;
    if (!known) logger.error(`Internal error during import: ${err.stack || err}`);
    httpStatus = known ? 400 : 500;
    code = known ? 1 : 2;
    message = known ? err.status : 'internalError';
  }
  res.status(httpStatus).json({code, message, data: {directDatabaseAccess}});
};
