'use strict';

import express from "express";

const log4js = require('log4js');
const clientLogger = log4js.getLogger('client');
const {Formidable} = require('formidable');
const apiHandler = require('../../handler/APIHandler');
const util = require('util');
import {objectAsString} from '../../utils/objectAsString';


exports.expressPreSession = async (hookName:string, {app}:any) => {
  app.use(express.json());
  // The Etherpad client side sends information about how a disconnect happened
  app.post('/ep/pad/connection-diagnostic-info', async (req:any, res:any) => {
    if (!req.body ||!req.body.diagnosticInfo || typeof req.body.diagnosticInfo !== 'object') {
      clientLogger.warn('DIAGNOSTIC-INFO: No diagnostic info provided');
      res.status(400).end('No diagnostic info provided');
      return;
    }

    clientLogger.info(`DIAGNOSTIC-INFO: ${objectAsString(req.body.diagnosticInfo)}`);
    res.end('OK');
  });

  const parseJserrorForm = async (req:any) => {
    const form = new Formidable({
      maxFileSize: 1, // Files are not expected. Not sure if 0 means unlimited, so 1 is used.
      // Same limit as express.json(). A real client error report is a few KB;
      // the 20MB formidable default let one unauthenticated request stall the
      // event loop for seconds and write tens of MB to the log.
      maxFieldsSize: 100 * 1024,
    });
    const [fields, files] = await form.parse(req);
    return fields.errorInfo;
  };

  // The Etherpad client side sends information about client side javscript errors
  app.post('/jserror', (req:any, res:any, next:Function) => {
    (async () => {
      let errorInfo;
      try {
        errorInfo = await parseJserrorForm(req);
      } catch (err:any) {
        if (err?.httpCode === 413) {
          clientLogger.warn('Rejected oversized client error report');
          res.status(413).end('Error report too large');
          return;
        }
        throw err;
      }
      const data = JSON.parse(errorInfo);
      clientLogger.warn(`${data.msg} --`, {
        [util.inspect.custom]: (depth: number, options:any) => {
          // The data is client-supplied, so keep the depth bounded.
          options = Object.assign({}, options, {depth: 10, colors: true});
          return util.inspect(data, options);
        },
      });
      res.end('OK');
    })().catch((err) => next(err || new Error(err)));
  });

  // Provide a possibility to query the latest available API version
  app.get('/api', (req:any, res:any) => {
    res.json({currentVersion: apiHandler.latestApiVersion});
  });
};
