'use strict';

import type {ArgsExpressType} from "../../types/ArgsExpressType.js";

import hasPadAccess from '../../padaccess.js';
import settings, {exportAvailable} from '../../utils/Settings.js';
import {anonymizeIp} from '../../utils/anonymizeIp.js';
import * as exportHandler from '../../handler/ExportHandler.js';
import * as importHandler from '../../handler/ImportHandler.js';
import * as padManager from '../../db/PadManager.js';
import readOnlyManager from '../../db/ReadOnlyManager.js';
import rateLimit from 'express-rate-limit';
import * as securityManager from '../../db/SecurityManager.js';
import * as webaccess from './webaccess.js';

export const expressCreateServer = (hookName:string, args:ArgsExpressType, cb:Function) => {
  const limiter = rateLimit({
    ...settings.importExportRateLimiting,
    handler: (request:any) => {
      if (request.rateLimit.current === request.rateLimit.limit + 1) {
        // when the rate limiter triggers, write a warning in the logs
        console.warn('Import/Export rate limiter triggered on ' +
            `"${request.originalUrl}" for IP address ` +
            `${anonymizeIp(request.ip, settings.ipLogging)}`);
      }
    },
  });

  // handle export requests
  args.app.use('/p/:pad{/:rev}/export/:type', limiter);
  args.app.get('/p/:pad{/:rev}/export/:type', (req:any, res:any, next:Function) => {
    (async () => {
      const types = ['pdf', 'doc', 'docx', 'txt', 'html', 'odt', 'etherpad'];
      // send a 404 if we don't support this filetype
      if (types.indexOf(req.params.type) === -1) {
        return next();
      }

      // When soffice is disabled, only block formats with no native path.
      // pdf and docx fall through to ExportHandler, which dispatches to
      // the in-process converters (issue #7538).
      if (exportAvailable() === 'no' &&
          ['odt', 'doc'].indexOf(req.params.type) !== -1) {
        console.error(`Impossible to export pad "${req.params.pad}" in ${req.params.type} format.` +
                      ' There is no converter configured');

        // ACHTUNG: do not include req.params.type in res.send() because there is
        // no HTML escaping and it would lead to an XSS
        res.send('This export is not enabled at this Etherpad instance. Set the path to soffice ' +
                 '(LibreOffice) in settings.json to enable this feature');
        return;
      }

      res.header('Access-Control-Allow-Origin', '*');

      if (await hasPadAccess(req, res)) {
        let padId = req.params.pad;

        let readOnlyId = null;
        if (readOnlyManager.isReadOnlyId(padId)) {
          readOnlyId = padId;
          padId = await readOnlyManager.getPadId(readOnlyId);
        }

        const exists = await padManager.doesPadExists(padId);
        if (!exists) {
          console.warn(`Someone tried to export a pad that doesn't exist (${padId})`);
          return next();
        }

        console.log(`Exporting pad "${req.params.pad}" in ${req.params.type} format`);
        await exportHandler.doExport(req, res, padId, readOnlyId, req.params.type);
      }
    })().catch((err) => {
      // Send a deterministic plain-text body for every export failure.
      // checkValidRev throws CustomError('...', 'apierror') for a bad :rev,
      // but conversion / fs / soffice errors also reach this handler — and
      // without an explicit response, all of them would fall through to
      // Express's default HTML error renderer, which is hostile to API
      // callers (and would be saved as a file by the browser because of
      // the attachment header set in doExport for non-apierror cases).
      if (res.headersSent) return next(err || new Error(err));
      // Clear the download header so the error body renders inline instead
      // of being saved as the requested filename.
      res.removeHeader('Content-Disposition');
      // Log the full error server-side for operators. apierrors are
      // user-facing validation errors and not worth a server-side log line.
      if (!err || err.name !== 'apierror') console.error('Export error:', err);
      const msg = (err && err.message) || 'Internal Server Error';
      return res.status(500).type('text/plain').send(msg);
    });
  });

  // handle import requests
  args.app.use('/p/:pad/import', limiter);
  args.app.post('/p/:pad/import', (req:any, res:any, next:Function) => {
    (async () => {
      // @ts-ignore
      const {session: {user} = {}} = req;
      const p = settings.cookie.prefix;
      const {accessStatus, authorID: authorId} = await securityManager.checkAccess(
          req.params.pad,
          req.cookies[`${p}sessionID`] || req.cookies.sessionID,
          req.cookies[`${p}token`] || req.cookies.token,
          user);
      if (accessStatus !== 'grant' || !webaccess.userCanModify(req.params.pad, req)) {
        return res.status(403).send('Forbidden');
      }
      await importHandler.doImport(req, res, req.params.pad, authorId);
    })().catch((err) => next(err || new Error(err)));
  });

  return cb();
};
