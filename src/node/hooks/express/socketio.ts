'use strict';

import {ArgsExpressType} from "../../types/ArgsExpressType";

import events from 'events';
const express = require('../express');
import log4js from 'log4js';
const proxyaddr = require('proxy-addr');
import settings from '../../utils/Settings';
import {Server, Socket} from 'socket.io'
const socketIORouter = require('../../handler/SocketIORouter');
const hooks = require('../../../static/js/pluginfw/hooks');
const padMessageHandler = require('../../handler/PadMessageHandler');

let io:any;
const logger = log4js.getLogger('socket.io');
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

export const expressCreateServer = (hookName:string, args:ArgsExpressType, cb:Function) => {
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
    session.connections++;
    session.save();
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
      .use(renewSession)
  io.of('/settings')
      .on('connection',handleConnection)
      .use(socketSessionMiddleware(args))
      .use(renewSession)

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
