'use strict';

import {ArgsExpressType} from "../../types/ArgsExpressType.js";
import {ErrorCaused} from "../../types/ErrorCaused.js";

import stats from '../../stats.js';

export let app: any = null;
export const expressCreateServer = (hook_name:string, args: ArgsExpressType, cb:Function) => {
  app = args.app;

  // The Etherpad error middleware. Sends a generic JSON 500 and logs the
  // error. We register this twice: once eagerly inside this hook, and once
  // again on `setImmediate` so it ends up after any other plugin's
  // `expressCreateServer` registrations. Express's router walks forward from
  // the layer that called `next(err)`, so the error handler must be the last
  // matching layer in the stack — registering only here would leave it before
  // the export/other routes that come from plugins that load after us.
  function errorHandler(err:ErrorCaused, req:any, res:any, next:Function) {
    if (res.headersSent) return next(err);
    // if an error occurs Connect will pass it down
    // through these "error-handling" middleware
    // allowing you to respond however you like
    res.status(500).send({error: err.message || 'Sorry, something bad happened!'});
    console.error(err.stack ? err.stack : err.toString());
    stats.meter('http500').mark();
  }
  args.app.use(errorHandler);
  setImmediate(() => args.app.use(errorHandler));

  return cb();
};
