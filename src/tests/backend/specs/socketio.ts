'use strict';

import {MapArrayType} from "../../../node/types/MapType";

const assert = require('assert').strict;
const common = require('../common');
const padManager = require('../../../node/db/PadManager');
const plugins = require('../../../static/js/pluginfw/plugin_defs');
import readOnlyManager from '../../../node/db/ReadOnlyManager';
import settings from '../../../node/utils/Settings';
const socketIoRouter = require('../../../node/handler/SocketIORouter');

describe(__filename, function () {
  this.timeout(30000);
  let agent: any;
  let authorize:Function;
  const backups:MapArrayType<any> = {};
  const cleanUpPads = async () => {
    const padIds = ['pad', 'other-pad', 'päd'];
    await Promise.all(padIds.map(async (padId) => {
      if (await padManager.doesPadExist(padId)) {
        const pad = await padManager.getPad(padId);
        await pad.remove();
      }
    }));
  };
  let socket:any;

  before(async function () { agent = await common.init(); });
  beforeEach(async function () {
    backups.hooks = {};
    for (const hookName of ['preAuthorize', 'authenticate', 'authorize']) {
      backups.hooks[hookName] = plugins.hooks[hookName];
      plugins.hooks[hookName] = [];
    }
    backups.settings = {};
    for (const setting of ['editOnly', 'requireAuthentication', 'requireAuthorization', 'users']) {
      // @ts-ignore
      backups.settings[setting] = settings[setting];
    }
    settings.editOnly = false;
    settings.requireAuthentication = false;
    settings.requireAuthorization = false;
    settings.users = {
      admin: {password: 'admin-password', is_admin: true},
      user: {password: 'user-password'},
    };
    assert(socket == null);
    authorize = () => true;
    plugins.hooks.authorize = [{hook_fn: (hookName: string, {req}:any, cb:Function) => cb([authorize(req)])}];
    await cleanUpPads();
  });
  afterEach(async function () {
    if (socket) socket.close();
    socket = null;
    await cleanUpPads();
    Object.assign(plugins.hooks, backups.hooks);
    Object.assign(settings, backups.settings);
  });

  describe('Normal accesses', function () {
    it('!authn anonymous cookie /p/pad -> 200, ok', async function () {
      const res = await agent.get('/p/pad').expect(200);
      socket = await common.connect(res);
      const clientVars = await common.handshake(socket, 'pad');
      assert.equal(clientVars.type, 'CLIENT_VARS');
    });
    it('!authn !cookie -> ok', async function () {
      socket = await common.connect(null);
      const clientVars = await common.handshake(socket, 'pad');
      assert.equal(clientVars.type, 'CLIENT_VARS');
    });
    it('!authn user /p/pad -> 200, ok', async function () {
      const res = await agent.get('/p/pad').auth('user', 'user-password').expect(200);
      socket = await common.connect(res);
      const clientVars = await common.handshake(socket, 'pad');
      assert.equal(clientVars.type, 'CLIENT_VARS');
    });
    it('authn user /p/pad -> 200, ok', async function () {
      settings.requireAuthentication = true;
      const res = await agent.get('/p/pad').auth('user', 'user-password').expect(200);
      socket = await common.connect(res);
      const clientVars = await common.handshake(socket, 'pad');
      assert.equal(clientVars.type, 'CLIENT_VARS');
    });

    for (const authn of [false, true]) {
      const desc = authn ? 'authn user' : '!authn anonymous';
      it(`${desc} read-only /p/pad -> 200, ok`, async function () {
        const get = (ep: string) => {
          let res = agent.get(ep);
          if (authn) res = res.auth('user', 'user-password');
          return res.expect(200);
        };
        settings.requireAuthentication = authn;
        let res = await get('/p/pad');
        socket = await common.connect(res);
        let clientVars = await common.handshake(socket, 'pad');
        assert.equal(clientVars.type, 'CLIENT_VARS');
        assert.equal(clientVars.data.readonly, false);
        const readOnlyId = clientVars.data.readOnlyId;
        assert(readOnlyManager.isReadOnlyId(readOnlyId));
        socket.close();
        res = await get(`/p/${readOnlyId}`);
        socket = await common.connect(res);
        clientVars = await common.handshake(socket, readOnlyId);
        assert.equal(clientVars.type, 'CLIENT_VARS');
        assert.equal(clientVars.data.readonly, true);
      });
    }

    it('authz user /p/pad -> 200, ok', async function () {
      settings.requireAuthentication = true;
      settings.requireAuthorization = true;
      const res = await agent.get('/p/pad').auth('user', 'user-password').expect(200);
      socket = await common.connect(res);
      const clientVars = await common.handshake(socket, 'pad');
      assert.equal(clientVars.type, 'CLIENT_VARS');
    });
    it('supports pad names with characters that must be percent-encoded', async function () {
      settings.requireAuthentication = true;
      // requireAuthorization is set to true here to guarantee that the user's padAuthorizations
      // object is populated. Technically this isn't necessary because the user's padAuthorizations
      // is currently populated even if requireAuthorization is false, but setting this to true
      // ensures the test remains useful if the implementation ever changes.
      settings.requireAuthorization = true;
      const encodedPadId = encodeURIComponent('päd');
      const res = await agent.get(`/p/${encodedPadId}`).auth('user', 'user-password').expect(200);
      socket = await common.connect(res);
      const clientVars = await common.handshake(socket, 'päd');
      assert.equal(clientVars.type, 'CLIENT_VARS');
    });
  });

  describe('Abnormal access attempts', function () {
    it('authn anonymous /p/pad -> 401, error', async function () {
      settings.requireAuthentication = true;
      const res = await agent.get('/p/pad').expect(401);
      // Despite the 401, try to create the pad via a socket.io connection anyway.
      socket = await common.connect(res);
      const message = await common.handshake(socket, 'pad');
      assert.equal(message.accessStatus, 'deny');
    });

    it('authn anonymous read-only /p/pad -> 401, error', async function () {
      settings.requireAuthentication = true;
      let res = await agent.get('/p/pad').auth('user', 'user-password').expect(200);
      socket = await common.connect(res);
      const clientVars = await common.handshake(socket, 'pad');
      assert.equal(clientVars.type, 'CLIENT_VARS');
      const readOnlyId = clientVars.data.readOnlyId;
      assert(readOnlyManager.isReadOnlyId(readOnlyId));
      socket.close();
      res = await agent.get(`/p/${readOnlyId}`).expect(401);
      // Despite the 401, try to read the pad via a socket.io connection anyway.
      socket = await common.connect(res);
      const message = await common.handshake(socket, readOnlyId);
      assert.equal(message.accessStatus, 'deny');
    });

    it('authn !cookie -> error', async function () {
      settings.requireAuthentication = true;
      socket = await common.connect(null);
      const message = await common.handshake(socket, 'pad');
      assert.equal(message.accessStatus, 'deny');
    });
    it('authorization bypass attempt -> error', async function () {
      // Only allowed to access /p/pad.
      authorize = (req:{
        path: string,
      }) => req.path === '/p/pad';
      settings.requireAuthentication = true;
      settings.requireAuthorization = true;
      // First authenticate and establish a session.
      const res = await agent.get('/p/pad').auth('user', 'user-password').expect(200);
      socket = await common.connect(res);
      // Accessing /p/other-pad should fail, despite the successful fetch of /p/pad.
      const message = await common.handshake(socket, 'other-pad');
      assert.equal(message.accessStatus, 'deny');
    });
  });

  describe('Authorization levels via authorize hook', function () {
    beforeEach(async function () {
      settings.requireAuthentication = true;
      settings.requireAuthorization = true;
    });

    it("level='create' -> can create", async function () {
      authorize = () => 'create';
      const res = await agent.get('/p/pad').auth('user', 'user-password').expect(200);
      socket = await common.connect(res);
      const clientVars = await common.handshake(socket, 'pad');
      assert.equal(clientVars.type, 'CLIENT_VARS');
      assert.equal(clientVars.data.readonly, false);
    });
    it('level=true -> can create', async function () {
      authorize = () => true;
      const res = await agent.get('/p/pad').auth('user', 'user-password').expect(200);
      socket = await common.connect(res);
      const clientVars = await common.handshake(socket, 'pad');
      assert.equal(clientVars.type, 'CLIENT_VARS');
      assert.equal(clientVars.data.readonly, false);
    });
    it("level='modify' -> can modify", async function () {
      await padManager.getPad('pad'); // Create the pad.
      authorize = () => 'modify';
      const res = await agent.get('/p/pad').auth('user', 'user-password').expect(200);
      socket = await common.connect(res);
      const clientVars = await common.handshake(socket, 'pad');
      assert.equal(clientVars.type, 'CLIENT_VARS');
      assert.equal(clientVars.data.readonly, false);
    });
    it("level='create' settings.editOnly=true -> unable to create", async function () {
      authorize = () => 'create';
      settings.editOnly = true;
      const res = await agent.get('/p/pad').auth('user', 'user-password').expect(200);
      socket = await common.connect(res);
      const message = await common.handshake(socket, 'pad');
      assert.equal(message.accessStatus, 'deny');
    });
    it("level='modify' settings.editOnly=false -> unable to create", async function () {
      authorize = () => 'modify';
      settings.editOnly = false;
      const res = await agent.get('/p/pad').auth('user', 'user-password').expect(200);
      socket = await common.connect(res);
      const message = await common.handshake(socket, 'pad');
      assert.equal(message.accessStatus, 'deny');
    });
    it("level='readOnly' -> unable to create", async function () {
      authorize = () => 'readOnly';
      const res = await agent.get('/p/pad').auth('user', 'user-password').expect(200);
      socket = await common.connect(res);
      const message = await common.handshake(socket, 'pad');
      assert.equal(message.accessStatus, 'deny');
    });
    it("level='readOnly' -> unable to modify", async function () {
      await padManager.getPad('pad'); // Create the pad.
      authorize = () => 'readOnly';
      const res = await agent.get('/p/pad').auth('user', 'user-password').expect(200);
      socket = await common.connect(res);
      const clientVars = await common.handshake(socket, 'pad');
      assert.equal(clientVars.type, 'CLIENT_VARS');
      assert.equal(clientVars.data.readonly, true);
    });
  });

  describe('Authorization levels via user settings', function () {
    beforeEach(async function () {
      settings.requireAuthentication = true;
    });

    it('user.canCreate = true -> can create and modify', async function () {
      settings.users.user.canCreate = true;
      const res = await agent.get('/p/pad').auth('user', 'user-password').expect(200);
      socket = await common.connect(res);
      const clientVars = await common.handshake(socket, 'pad');
      assert.equal(clientVars.type, 'CLIENT_VARS');
      assert.equal(clientVars.data.readonly, false);
    });
    it('user.canCreate = false -> unable to create', async function () {
      settings.users.user.canCreate = false;
      const res = await agent.get('/p/pad').auth('user', 'user-password').expect(200);
      socket = await common.connect(res);
      const message = await common.handshake(socket, 'pad');
      assert.equal(message.accessStatus, 'deny');
    });
    it('user.readOnly = true -> unable to create', async function () {
      settings.users.user.readOnly = true;
      const res = await agent.get('/p/pad').auth('user', 'user-password').expect(200);
      socket = await common.connect(res);
      const message = await common.handshake(socket, 'pad');
      assert.equal(message.accessStatus, 'deny');
    });
    it('user.readOnly = true -> unable to modify', async function () {
      await padManager.getPad('pad'); // Create the pad.
      settings.users.user.readOnly = true;
      const res = await agent.get('/p/pad').auth('user', 'user-password').expect(200);
      socket = await common.connect(res);
      const clientVars = await common.handshake(socket, 'pad');
      assert.equal(clientVars.type, 'CLIENT_VARS');
      assert.equal(clientVars.data.readonly, true);
    });
    it('user.readOnly = false -> can create and modify', async function () {
      settings.users.user.readOnly = false;
      const res = await agent.get('/p/pad').auth('user', 'user-password').expect(200);
      socket = await common.connect(res);
      const clientVars = await common.handshake(socket, 'pad');
      assert.equal(clientVars.type, 'CLIENT_VARS');
      assert.equal(clientVars.data.readonly, false);
    });
    it('user.readOnly = true, user.canCreate = true -> unable to create', async function () {
      settings.users.user.canCreate = true;
      settings.users.user.readOnly = true;
      const res = await agent.get('/p/pad').auth('user', 'user-password').expect(200);
      socket = await common.connect(res);
      const message = await common.handshake(socket, 'pad');
      assert.equal(message.accessStatus, 'deny');
    });
  });

  describe('Authorization level interaction between authorize hook and user settings', function () {
    beforeEach(async function () {
      settings.requireAuthentication = true;
      settings.requireAuthorization = true;
    });

    it('authorize hook does not elevate level from user settings', async function () {
      settings.users.user.readOnly = true;
      authorize = () => 'create';
      const res = await agent.get('/p/pad').auth('user', 'user-password').expect(200);
      socket = await common.connect(res);
      const message = await common.handshake(socket, 'pad');
      assert.equal(message.accessStatus, 'deny');
    });
    it('user settings does not elevate level from authorize hook', async function () {
      settings.users.user.readOnly = false;
      settings.users.user.canCreate = true;
      authorize = () => 'readOnly';
      const res = await agent.get('/p/pad').auth('user', 'user-password').expect(200);
      socket = await common.connect(res);
      const message = await common.handshake(socket, 'pad');
      assert.equal(message.accessStatus, 'deny');
    });
  });

  describe('SocketIORouter.js', function () {
    const Module = class {
      setSocketIO(io:any) {}
      handleConnect(socket:any) {}
      handleDisconnect(socket:any) {}
      handleMessage(socket:any, message:string) {}
    };

    afterEach(async function () {
      socketIoRouter.deleteComponent(this.test!.fullTitle());
      socketIoRouter.deleteComponent(`${this.test!.fullTitle()} #2`);
    });

    it('setSocketIO', async function () {
      let ioServer;
      socketIoRouter.addComponent(this.test!.fullTitle(), new class extends Module {
        setSocketIO(io:any) { ioServer = io; }
      }());
      assert(ioServer != null);
    });

    it('handleConnect', async function () {
      let serverSocket;
      socketIoRouter.addComponent(this.test!.fullTitle(), new class extends Module {
        handleConnect(socket:any) { serverSocket = socket; }
      }());
      socket = await common.connect();
      assert(serverSocket != null);
    });

    it('handleDisconnect', async function () {
      let resolveConnected:  (value: void | PromiseLike<void>) => void ;
      const connected = new Promise((resolve) => resolveConnected = resolve);
      let resolveDisconnected: (value: void | PromiseLike<void>) => void ;
      const disconnected = new Promise<void>((resolve) => resolveDisconnected = resolve);
      socketIoRouter.addComponent(this.test!.fullTitle(), new class extends Module {
        private _socket: any;
        handleConnect(socket:any) {
          this._socket = socket;
          resolveConnected();
        }
        handleDisconnect(socket:any) {
          assert(socket != null);
          // There might be lingering disconnect events from sockets created by other tests.
          if (this._socket == null || socket.id !== this._socket.id) return;
          assert.equal(socket, this._socket);
          resolveDisconnected();
        }
      }());
      socket = await common.connect();
      await connected;
      socket.close();
      socket = null;
      await disconnected;
    });

    it('handleMessage (success)', async function () {
      let serverSocket:any;
      const want = {
        component: this.test!.fullTitle(),
        foo: {bar: 'asdf'},
      };
      let rx:Function;
      const got = new Promise((resolve) => { rx = resolve; });
      socketIoRouter.addComponent(this.test!.fullTitle(), new class extends Module {
        handleConnect(socket:any) { serverSocket = socket; }
        handleMessage(socket:any, message:string) { assert.equal(socket, serverSocket); rx(message); }
      }());
      socketIoRouter.addComponent(`${this.test!.fullTitle()} #2`, new class extends Module {
        handleMessage(socket:any, message:any) { assert.fail('wrong handler called'); }
      }());
      socket = await common.connect();
      socket.emit('message', want);
      assert.deepEqual(await got, want);
    });

    const tx = async (socket:any, message = {}) => await new Promise((resolve, reject) => {
      const AckErr = class extends Error {
        constructor(name: string, ...args:any) { super(...args); this.name = name; }
      };
      socket.emit('message', message,
          (errj: {
            message: string,
            name: string,
          }, val: any) => errj != null ? reject(new AckErr(errj.name, errj.message)) : resolve(val));
    });

    it('handleMessage with ack (success)', async function () {
      const want = 'value';
      socketIoRouter.addComponent(this.test!.fullTitle(), new class extends Module {
        handleMessage(socket:any, msg:any) { return want; }
      }());
      socket = await common.connect();
      const got = await tx(socket, {component: this.test!.fullTitle()});
      assert.equal(got, want);
    });

    it('handleMessage with ack (error)', async function () {
      const InjectedError = class extends Error {
        constructor() { super('injected test error'); this.name = 'InjectedError'; }
      };
      socketIoRouter.addComponent(this.test!.fullTitle(), new class extends Module {
        handleMessage(socket:any, msg:any) { throw new InjectedError(); }
      }());
      socket = await common.connect();
      await assert.rejects(tx(socket, {component: this.test!.fullTitle()}), new InjectedError());
    });
  });
});
