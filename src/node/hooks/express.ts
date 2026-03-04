'use strict';

import {Socket} from "node:net";
import type {MapArrayType} from "../types/MapType";

import _ from 'underscore';
import cookieParser from 'cookie-parser';
import events from 'events';
import express from 'express';
import expressSession, {Store} from 'express-session';
import fs from 'fs';
const hooks = require('../../static/js/pluginfw/hooks');
import log4js from 'log4js';
const SessionStore = require('../db/SessionStore');
import settings, {getEpVersion, getGitCommit} from '../utils/Settings';
const stats = require('../stats')
import util from 'util';
const webaccess = require('./express/webaccess');

import SecretRotator from '../security/SecretRotator';

let secretRotator: SecretRotator|null = null;
const logger = log4js.getLogger('http');
let serverName:string;
let sessionStore: Store | null;
const sockets:Set<Socket> = new Set();
const socketsEvents = new events.EventEmitter();
const startTime = stats.settableGauge('httpStartTime');

exports.server = null;

const closeServer = async () => {
  if (exports.server != null) {
    logger.info('Closing HTTP server...');
    // Call exports.server.close() to reject new connections but don't await just yet because the
    // Promise won't resolve until all preexisting connections are closed.
    const p = util.promisify(exports.server.close.bind(exports.server))();
    await hooks.aCallAll('expressCloseServer');
    // Give existing connections some time to close on their own before forcibly terminating. The
    // time should be long enough to avoid interrupting most preexisting transmissions but short
    // enough to avoid a noticeable outage.
    const timeout = setTimeout(async () => {
      logger.info(`Forcibly terminating remaining ${sockets.size} HTTP connections...`);
      for (const socket of sockets) socket.destroy(new Error('HTTP server is closing'));
    }, 5000);
    let lastLogged = 0;
    while (sockets.size > 0  && !settings.enableAdminUITests) {
      if (Date.now() - lastLogged > 1000) { // Rate limit to avoid filling logs.
        logger.info(`Waiting for ${sockets.size} HTTP clients to disconnect...`);
        lastLogged = Date.now();
      }
      await events.once(socketsEvents, 'updated');
    }
    await p;
    clearTimeout(timeout);
    exports.server = null;
    startTime.setValue(0);
    logger.info('HTTP server closed');
  }
  // @ts-ignore
  if (sessionStore) sessionStore.shutdown();
  sessionStore = null;
  if (secretRotator) secretRotator.stop();
  secretRotator = null;
};

exports.createServer = async () => {
  console.log('Report bugs at https://github.com/ether/etherpad-lite/issues');

  serverName = `Etherpad ${getGitCommit()} (https://etherpad.org)`;

  console.log(`Your Etherpad version is ${getEpVersion()} (${getGitCommit()})`);

  await exports.restartServer();

  if (settings.ip === '') {
    // using Unix socket for connectivity
    console.log(`You can access your Etherpad instance using the Unix socket at ${settings.port}`);
  } else {
    console.log(`You can access your Etherpad instance at http://${settings.ip}:${settings.port}/`);
  }

  if (!_.isEmpty(settings.users)) {
    console.log(`The plugin admin page is at http://${settings.ip}:${settings.port}/admin/plugins`);
  } else {
    console.warn('Admin username and password not set in settings.json. ' +
                 'To access admin please uncomment and edit "users" in settings.json');
  }

  const env = process.env.NODE_ENV || 'development';

  if (env !== 'production') {
    console.warn('Etherpad is running in Development mode. This mode is slower for users and ' +
                 'less secure than production mode. You should set the NODE_ENV environment ' +
                 'variable to production by using: export NODE_ENV=production');
  }
};

exports.restartServer = async () => {
  await closeServer();

  const app = express(); // New syntax for express v3

  if (settings.ssl) {
    console.log('SSL -- enabled');
    console.log(`SSL -- server key file: ${settings.ssl.key}`);
    console.log(`SSL -- Certificate Authority's certificate file: ${settings.ssl.cert}`);

    const options: MapArrayType<any> = {
      key: fs.readFileSync(settings.ssl.key),
      cert: fs.readFileSync(settings.ssl.cert),
    };

    if (settings.ssl.ca) {
      options.ca = [];
      for (let i = 0; i < settings.ssl.ca.length; i++) {
        const caFileName = settings.ssl.ca[i];
        options.ca.push(fs.readFileSync(caFileName));
      }
    }

    const https = require('https');
    exports.server = https.createServer(options, app);
  } else {
    const http = require('http');
    exports.server = http.createServer(app);
  }

  app.use((req, res, next) => {
    // res.header("X-Frame-Options", "deny"); // breaks embedded pads
    if (settings.ssl) {
      // we use SSL
      res.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }

    // Stop IE going into compatability mode
    // https://github.com/ether/etherpad-lite/issues/2547
    res.header('X-UA-Compatible', 'IE=Edge,chrome=1');

    // Enable a strong referrer policy. Same-origin won't drop Referers when
    // loading local resources, but it will drop them when loading foreign resources.
    // It's still a last bastion of referrer security. External URLs should be
    // already marked with rel="noreferer" and user-generated content pages are already
    // marked with <meta name="referrer" content="no-referrer">
    // https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Referrer-Policy
    // https://github.com/ether/etherpad-lite/pull/3636
    res.header('Referrer-Policy', 'same-origin');

    // send git version in the Server response header if exposeVersion is true.
    if (settings.exposeVersion) {
      res.header('Server', serverName);
    }

    next();
  });

  if (settings.trustProxy) {
    /*
     * If 'trust proxy' === true, the client’s IP address in req.ip will be the
     * left-most entry in the X-Forwarded-* header.
     *
     * Source: https://expressjs.com/en/guide/behind-proxies.html
     */
    app.enable('trust proxy');
  }

  // Measure response time
  app.use((req, res, next) => {
    const stopWatch = stats.timer('httpRequests').start();
    const sendFn = res.send.bind(res);
    res.send = (...args) => {   stopWatch.end(); return sendFn(...args); };
    next();
  });

  // If the log level specified in the config file is WARN or ERROR the application server never
  // starts listening to requests as reported in issue #158. Not installing the log4js connect
  // logger when the log level has a higher severity than INFO since it would not log at that level
  // anyway.
  if (!(settings.loglevel === 'WARN' || settings.loglevel === 'ERROR')) {
    app.use(log4js.connectLogger(logger, {
      level: log4js.levels.DEBUG.levelStr,
      format: ':status, :method :url',
    }));
  }

  const {keyRotationInterval, sessionLifetime} = settings.cookie;
  let secret = settings.sessionKey;
  if (keyRotationInterval && sessionLifetime) {
    secretRotator = new SecretRotator(
        'expressSessionSecrets', keyRotationInterval, sessionLifetime, settings.sessionKey);
    await secretRotator.start();
    const secrets = secretRotator.secrets;
    if (Array.isArray(secrets)) {
      secret = secrets[0];
    } else {
      secret = secretRotator.secrets as unknown as string;
    }
  }
  if (!secret) throw new Error('missing cookie signing secret');

  app.use(cookieParser(secret, {}));

  sessionStore = new SessionStore(settings.cookie.sessionRefreshInterval);
  exports.sessionMiddleware = expressSession({
    rolling: true,
    secret,
    store: sessionStore ?? undefined,
    resave: false,
    saveUninitialized: false,
    // Set the cookie name to a javascript identifier compatible string. Makes code handling it
    // cleaner :)
    name: 'express_sid',
    cookie: {
      maxAge: sessionLifetime || undefined, // Convert 0 to null.
      sameSite: settings.cookie.sameSite,

      // The automatic express-session mechanism for determining if the application is being served
      // over ssl is similar to the one used for setting the language cookie, which check if one of
      // these conditions is true:
      //
      //   1. we are directly serving the nodejs application over SSL, using the "ssl" options in
      //      settings.json
      //
      //   2. we are serving the nodejs application in plaintext, but we are using a reverse proxy
      //      that terminates SSL for us. In this case, the user has to set trustProxy = true in
      //      settings.json, and the information wheter the application is over SSL or not will be
      //      extracted from the X-Forwarded-Proto HTTP header
      //
      // Please note that this will not be compatible with applications being served over http and
      // https at the same time.
      //
      // reference: https://github.com/expressjs/session/blob/v1.17.0/README.md#cookiesecure
      secure: 'auto',
    },
  });

  // Give plugins an opportunity to install handlers/middleware before the express-session
  // middleware. This allows plugins to avoid creating an express-session record in the database
  // when it is not needed (e.g., public static content).
  await hooks.aCallAll('expressPreSession', {app, settings});
  app.use(exports.sessionMiddleware);

  app.use(webaccess.checkAccess);

  await Promise.all([
    hooks.aCallAll('expressConfigure', {app}),
    hooks.aCallAll('expressCreateServer', {app, server: exports.server}),
  ]);
  exports.server.on('connection', (socket:Socket) => {
    sockets.add(socket);
    socketsEvents.emit('updated');
    socket.on('close', () => {
      sockets.delete(socket);
      socketsEvents.emit('updated');
    });
  });
  await util.promisify(exports.server.listen).bind(exports.server)(settings.port, settings.ip);
  startTime.setValue(Date.now());
  logger.info('HTTP server listening for connections');
};

exports.shutdown = async (hookName:string, context: any) => {
  await closeServer();
};
