'use strict';

import {ArgsExpressType} from "../../types/ArgsExpressType.js";
import {ErrorCaused} from "../../types/ErrorCaused.js";

import stats from '../../stats.js';

export let app: any = null;
export const expressCreateServer = (hook_name:string, args: ArgsExpressType, cb:Function) => {
  app = args.app;

  // Handle errors
  args.app.use((err:ErrorCaused, req:any, res:any, next:Function) => {
    // if an error occurs Connect will pass it down
    // through these "error-handling" middleware
    // allowing you to respond however you like
    res.status(500).send({error: 'Sorry, something bad happened!'});
    console.error(err.stack ? err.stack : err.toString());
    stats.meter('http500').mark();
  });

  return cb();
};
