'use strict';

import {ArgsExpressType} from "../../types/ArgsExpressType";

import events from 'events';
const express = require('../express');
import log4js from 'log4js';
const proxyaddr = require('proxy-addr');
import settings from '../../utils/Settings';
import {Server, Socket} from 'socket.io'
import {
  checkSocketOrigin, isValidAdminSocketToken, isValidPadSocketToken, padCredentialBinding,
} from '../../utils/socketOrigin';
const socketIORouter = require('../../handler/SocketIORouter');
const hooks = require('../../../static/js/pluginfw/hooks');
const padMessageHandler = require('../../handler/PadMessageHandler');

let io:any;
const logger = log4js.getLogger('socket.io');

/** Returns the socket.io Server once expressCreateServer has run, or null otherwise. Used by features that need to broadcast outside the regular hook surface. */
export const getIo = (): any => io;
const sockets = new Set();
const socketsEvents = new events.EventEmitter();

export const expressCloseServer = async () => {
  if (io == null) return;
  logger.info('Closing socket.io engine...');
  // Close the socket.io engine to disconnect existing clients and reject new clients. Don't call
  // io.close() because that closes the underlying HTTP server, which is already done elsewhere.
  // (Closing an HTTP server twice throws an exception.) The `engine` property of socket.io Server
  // objects is undocumented, but I don't see any other way to shut down socket.io without also
  // closing the HTTP server.
  io.engine.close();
  // Closing the socket.io engine should disconnect all clients but it is not documented. Wait for
  // all of the connections to close to make sure, and log the progress so that we can troubleshoot
  // if socket.io's behavior ever changes.
  //
  // Note: `io.sockets.clients()` should not be used here to track the remaining clients.
  // `io.sockets.clients()` works with socket.io 2.x, but not with 3.x: With socket.io 2.x all
  // clients are always added to the default namespace (`io.sockets`) even if they specified a
  // different namespace upon connection, but with socket.io 3.x clients are NOT added to the
  // default namespace if they have specified a different namespace. With socket.io 3.x there does
  // not appear to be a way to get all clients across all namespaces without tracking them
  // ourselves, so that is what we do.
  let lastLogged = 0;
  while (sockets.size > 0 && !settings.enableAdminUITests) {
    if (Date.now() - lastLogged > 1000) { // Rate limit to avoid filling logs.
      logger.info(`Waiting for ${sockets.size} socket.io clients to disconnect...`);
      lastLogged = Date.now();
    }
    await events.once(socketsEvents, 'updated');
  }
  logger.info('All socket.io clients have disconnected');
};

const socketSessionMiddleware = (args: any) => (socket: any, next: Function) => {
  const req = socket.request;
  // Express sets req.ip but socket.io does not. Replicate Express's behavior here.
  if (req.ip == null) {
    if (settings.trustProxy) {
      req.ip = proxyaddr(req, args.app.get('trust proxy fn'));
    } else {
      req.ip = socket.handshake.address;
    }
  }
  if (!req.headers.cookie) {
    // socketio.js-client on node.js doesn't support cookies, so pass them via a query parameter.
    req.headers.cookie = socket.handshake.query.cookie;
  }
  express.sessionMiddleware(req, {}, next);
};

// The admin SPA's Vite dev server (`pnpm --filter admin dev`) is served from
// localhost:5173 and opens its sockets directly against :9001, so allow it
// when Etherpad itself is running in development mode.
const devOrigins = (): string[] =>
  process.env.NODE_ENV === 'development' ? ['http://localhost:5173'] : [];

let lastOriginWarning = 0;

let expressApp: any = null;

const checkOrigin = (socket: any, next: Function) => {
  const decision = checkSocketOrigin(socket.request, {
    trustProxy: settings.trustProxy,
    publicURL: settings.publicURL,
    allowedOrigins: settings.socketIo?.allowedOrigins,
    extraOrigins: devOrigins(),
    tokenValid: isValidAdminSocketToken(
        socket.request?.sessionID, socket.handshake?.auth?.adminSocketToken),
  });
  if (decision.allowed) return next();
  // Without an admin session the admin UI cannot get a token, so the rejection
  // is about the missing login, not the origin. Don't point the operator at
  // socketIo.allowedOrigins for that. The client gets the same error either
  // way, so a page on another origin cannot tell whether the visitor is an
  // admin.
  const isAdmin = !!socket.request?.session?.user?.is_admin;
  if (isAdmin && Date.now() - lastOriginWarning > 10000) { // Rate limit to avoid filling logs.
    lastOriginWarning = Date.now();
    const host = String(socket.request.headers.host ?? '').slice(0, 255).replace(/[\r\n]/g, '');
    logger.warn(`Rejected socket.io connection to ${socket.nsp?.name} from Origin ` +
        `${JSON.stringify(String(decision.origin).slice(0, 255))} (Host: ${JSON.stringify(host)}): ` +
        `${decision.reason}. ` +
        'If this origin should be allowed to use the admin UI, add it to ' +
        '"socketIo.allowedOrigins" in settings.json.');
  } else if (!isAdmin) {
    logger.debug(`Rejected socket.io connection to ${socket.nsp?.name} without an admin ` +
        `session: ${decision.reason}`);
  }
  const err: any = new Error('origin not allowed');
  err.data = {code: 'origin_not_allowed'};
  next(err);
};

/**
 * socket.io namespace middleware that rejects handshakes opened by a page on
 * another origin (see utils/socketOrigin.ts for the rules). Registered on the
 * privileged admin namespaces; exported so plugins that add their own
 * privileged namespaces can use it too:
 * `io.of('/my-admin-ns').use(originCheckMiddleware)`. It loads the express
 * session itself if no earlier middleware has, because the admin socket token
 * is checked against the session.
 */
export const originCheckMiddleware = (socket: any, next: Function) => {
  if (socket.request?.sessionID != null || expressApp == null) return checkOrigin(socket, next);
  socketSessionMiddleware({app: expressApp})(socket, (err: any) => {
    if (err) return next(err);
    checkOrigin(socket, next);
  });
};

const asList = (v: unknown): string[] => {
  if (v == null) return [];
  return Array.isArray(v) ? v : String(v).split(',');
};

let lastPadOriginLog = 0;

/**
 * Origin check for the default (pad) namespace. Unlike the admin namespaces,
 * pads are legitimately used from other sites: an embedded pad is a
 * cross-site iframe. That iframe is still an Etherpad page, so its socket is
 * opened from Etherpad's own origin and passes. What fails is a socket opened
 * directly by a page on another origin (a sibling subdomain, or any site when
 * cookies are SameSite=None). By default such a socket still connects, but
 * the browser's cookies are ignored: it gets a fresh anonymous author rather
 * than the visitor's author token, group session or login. See
 * utils/socketOrigin.ts for how a handshake is judged; the pad client sends a
 * pad socket token, so the check does not depend on the Host header.
 */
export const padOriginMiddleware = (socket: any, next: Function) => {
  const policy = settings.socketIo?.crossOriginPadSockets || 'anonymous';
  if (socket.data == null) socket.data = {};
  if (policy === 'allow') {
    socket.data.ambientCredentials = true;
    return next();
  }
  const decision = checkSocketOrigin(socket.request, {
    trustProxy: settings.trustProxy,
    publicURL: settings.publicURL,
    allowedOrigins: [
      ...asList(settings.socketIo?.allowedOrigins),
      ...asList(settings.socketIo?.padAllowedOrigins),
    ],
    tokenValid: isValidPadSocketToken(
        padCredentialBinding(socket.request, settings.cookie?.prefix || ''),
        socket.handshake?.auth?.padSocketToken),
  });
  socket.data.ambientCredentials = decision.allowed;
  if (decision.allowed) return next();
  if (Date.now() - lastPadOriginLog > 10000) { // Rate limit to avoid filling logs.
    lastPadOriginLog = Date.now();
    logger.info(`Pad socket.io connection from Origin ` +
        `${JSON.stringify(String(decision.origin).slice(0, 255))} is not from this server ` +
        `(${decision.reason}); ` +
        (policy !== 'anonymous' ? 'rejected it. ' : 'ignoring its cookies (anonymous author). ') +
        'If this origin should act with the visitor\'s cookies, add it to ' +
        '"socketIo.padAllowedOrigins" in settings.json.');
  }
  // Anything but "anonymous" here is "reject" (Settings validates the value;
  // this keeps a value changed at runtime from failing open).
  if (policy !== 'anonymous') {
    const err: any = new Error('origin not allowed');
    err.data = {code: 'origin_not_allowed'};
    return next(err);
  }
  stripAmbientCredentials(socket.request);
  next();
};

/**
 * Removes the browser's cookies and the express session from a handshake
 * request, so nothing that runs later can act on them: core reads go through
 * PadMessageHandler's credentialRequest(), but plugin hooks (handleMessage,
 * handleMessageSecurity, clientVars, userJoin, ...) get the raw socket. Other
 * namespaces on the same connection share this request object, so they see
 * the stripped request too once the pad namespace has connected; a plugin
 * namespace that needs a guarantee should run its own origin check.
 */
const stripAmbientCredentials = (req: any) => {
  if (req == null) return;
  if (req.headers != null) delete req.headers.cookie;
  // A plain object, not an express-session Session: it has no save() or
  // touch(), so it cannot write to or renew the visitor's stored session.
  req.session = {};
  req.sessionID = undefined;
  req.sessionStore = undefined;
};

export const expressCreateServer = (hookName:string, args:ArgsExpressType, cb:Function) => {
  expressApp = args.app;
  // init socket.io and redirect all requests to the MessageHandler
  // there shouldn't be a browser that isn't compatible to all
  // transports in this list at once
  // e.g. XHR is disabled in IE by default, so in IE it should use jsonp-polling
  io = new Server(args.server,{
    transports: settings.socketTransportProtocols,
    cookie: false,
    maxHttpBufferSize: settings.socketIo.maxHttpBufferSize,
  })


  const handleConnection = (socket:Socket) => {
    sockets.add(socket);
    socketsEvents.emit('updated');
    // https://socket.io/docs/v3/faq/index.html
    // @ts-ignore
    const session = socket.request.session;
    // @ts-ignore
    if (session != null && socket.data?.ambientCredentials !== false) {
      session.connections++;
      session.save();
    }
    socket.on('disconnect', () => {
      sockets.delete(socket);
      socketsEvents.emit('updated');
    });
  }

  const renewSession = (socket:any, next:Function) => {
    socket.conn.on('packet', (packet:string) => {
      // Tell express-session that the session is still active. The session store can use these
      // touch events to defer automatic session cleanup, and if express-session is configured with
      // rolling=true the cookie's expiration time will be renewed. (Note that WebSockets does not
      // have a standard mechanism for periodically updating the browser's cookies, so the browser
      // will not see the new cookie expiration time unless it makes a new HTTP request or the new
      // cookie value is sent to the client in a custom socket.io message.)
      // A socket that may not use the browser's cookies must not keep the
      // visitor's session alive either.
      if (socket.data?.ambientCredentials === false) return;
      if (socket.request.session != null) socket.request.session.touch();
    });
    next();
  }


  io.on('connection', handleConnection);

  io.use(socketSessionMiddleware(args));

  // Temporary workaround so all clients go through middleware and handle connection
  io.of('/pluginfw/installer')
      .on('connection',handleConnection)
      .use(socketSessionMiddleware(args))
      .use(originCheckMiddleware)
      .use(renewSession)
  io.of('/settings')
      .on('connection',handleConnection)
      .use(socketSessionMiddleware(args))
      .use(originCheckMiddleware)
      .use(renewSession)

  io.use(padOriginMiddleware);
  io.use(renewSession);

  // var socketIOLogger = log4js.getLogger("socket.io");
  // Debug logging now has to be set at an environment level, this is stupid.
  // https://github.com/Automattic/socket.io/wiki/Migrating-to-1.0
  // This debug logging environment is set in Settings.js

  // minify socket.io javascript
  // Due to a shitty decision by the SocketIO team minification is
  // no longer available, details available at:
  // http://stackoverflow.com/questions/23981741/minify-socket-io-socket-io-js-with-1-0
  // if(settings.minify) io.enable('browser client minification');

  // Initialize the Socket.IO Router
  socketIORouter.setSocketIO(io);
  socketIORouter.addComponent('pad', padMessageHandler);

  hooks.callAll('socketio', {app: args.app, io, server: args.server});

  return cb();
};
