'use strict';

import {ArgsExpressType} from "../../types/ArgsExpressType";

const padManager = require('../../db/PadManager');

exports.expressCreateServer = (hookName:string, args:ArgsExpressType, cb:Function) => {
  // redirects browser to the pad's sanitized url if needed. otherwise, renders the html
  args.app.param('pad', (req:any, res:any, next:Function, padId:string) => {
    (async () => {
      // Reject URLs ending in `/` outright.
      if (/\/$/.test(req.url)) {
        res.status(404).send('Such a padname is forbidden');
        return;
      }

      // Sanitize FIRST, then validate the sanitized result. sanitizePadId maps
      // legacy characters (whitespace and the ueberdb delimiter `:`) to `_`, so
      // a URL like `/p/foo:bar` still redirects to `/p/foo_bar` even though `:`
      // is not itself a valid pad id (GHSA-wg58-mhwv-35pq). An id that stays
      // invalid after sanitizing (e.g. one containing `$`) is forbidden.
      const sanitizedPadId = await padManager.sanitizePadId(padId);

      // A pad that already exists keeps its URL even if its id is no longer a
      // valid one to *create*: `:` was accepted by isValidPadId until
      // GHSA-wg58-mhwv-35pq, so pads carrying one exist in the wild (that is why
      // padIdTransforms maps `:` in the first place) and 404ing them would lock
      // their content away. Only ids that are invalid AND unknown are rejected —
      // opening a pad URL creates the pad, so this is what keeps new invalid ids
      // out.
      if (!padManager.isValidPadId(sanitizedPadId) &&
          !(await padManager.doesPadExist(sanitizedPadId))) {
        res.status(404).send('Such a padname is forbidden');
        return;
      }

      if (sanitizedPadId === padId) {
        // the pad id was fine, so just render it
        next();
      } else {
        // the pad id was sanitized, so we redirect to the sanitized version
        const realURL =
            encodeURIComponent(sanitizedPadId) + new URL(req.url, 'http://invalid.invalid').search;
        res.header('Location', realURL);
        res.status(302).send(`You should be redirected to <a href="${realURL}">${realURL}</a>`);
      }
    })().catch((err) => next(err || new Error(err)));
  });
  return cb();
};
