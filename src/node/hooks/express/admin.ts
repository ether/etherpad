'use strict';
import {ArgsExpressType} from "../../types/ArgsExpressType";
import path from "path";
import fs from "fs";
import {MapArrayType} from "../../types/MapType";

import settings from 'ep_etherpad-lite/node/utils/Settings';

const ADMIN_PATH = path.join(settings.root, 'src', 'templates');
const PROXY_HEADER = "x-proxy-path"
/**
 * Add the admin navigation link
 * @param hookName {String} the name of the hook
 * @param args {Object} the object containing the arguments
 * @param {Function} cb  the callback function
 * @return {*}
 */
exports.expressCreateServer = (hookName: string, args: ArgsExpressType, cb: Function): any => {

  if (!fs.existsSync(ADMIN_PATH)) {
    console.error('admin template not found, skipping admin interface. You need to rebuild it in /admin with pnpm run build-copy')
    return cb();
  }
  args.app.get('/admin/{*filename}', (req: any, res: any) => {
    // extract URL path
    let pathname = path.join(ADMIN_PATH, req.url);
    pathname = path.normalize(pathname)

    if (!pathname.startsWith(ADMIN_PATH)) {
      res.statusCode = 403;
      return res.end("Forbidden");
    }
    // based on the URL path, extract the file extension. e.g. .js, .doc, ...
    let ext = path.parse(pathname).ext;
    // maps file extension to MIME typere
    const map: MapArrayType<string> = {
      '.ico': 'image/x-icon',
      '.html': 'text/html',
      '.js': 'text/javascript',
      '.json': 'application/json',
      '.css': 'text/css',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.wav': 'audio/wav',
      '.mp3': 'audio/mpeg',
      '.svg': 'image/svg+xml',
      '.pdf': 'application/pdf',
      '.doc': 'application/msword'
    };

    fs.exists(pathname, function (exist) {
      if (!exist) {
        // if the file is not found, return 404
        res.statusCode = 200;
        pathname = ADMIN_PATH + "/admin/index.html"
        ext = path.parse(pathname).ext;
      }

      // if is a directory search for index file matching the extension
      if (exist && fs.statSync(pathname).isDirectory()) {
        pathname = pathname + '/index.html';
        ext = path.parse(pathname).ext;
      }

      // read file from file system
      fs.readFile(pathname, function (err, data) {
        if (err) {
          res.statusCode = 500;
          res.end(`Error getting the file: ${err}.`);
        } else {
          let dataToSend:Buffer|string = data
          // if the file is found, set Content-type and send data
          res.setHeader('Content-type', map[ext] || 'text/plain');
          if (ext === ".html" || ext === ".js" || ext === ".css") {
            if (req.header(PROXY_HEADER)) {
              let string = data.toString()
              dataToSend = string.replaceAll("/admin", req.header(PROXY_HEADER) + "/admin")
              dataToSend = dataToSend.replaceAll("/socket.io", req.header(PROXY_HEADER) + "/socket.io")
            }
          }
          res.end(dataToSend);
        }
      });
    })
  });
  args.app.get('/admin', (req: any, res: any, next: Function) => {
    if ('/' !== req.path[req.path.length - 1]) return res.redirect('./admin/');
  })
  return cb();
};
