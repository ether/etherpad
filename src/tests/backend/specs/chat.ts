'use strict';

import {MapArrayType} from "../../../node/types/MapType";
import {PluginDef} from "../../../node/types/PartType";

import ChatMessage from '../../../static/js/ChatMessage';
const {Pad} = require('../../../node/db/Pad');
const assert = require('assert').strict;
const common = require('../common');
const padManager = require('../../../node/db/PadManager');
const pluginDefs = require('../../../static/js/pluginfw/plugin_defs');

const logger = common.logger;

type CheckFN = ({message, pad, padId}:{
  message?: typeof ChatMessage,
  pad?: typeof Pad,
  padId?: string,
})=>void;

const checkHook = async (hookName: string, checkFn?:CheckFN) => {
  if (pluginDefs.hooks[hookName] == null) pluginDefs.hooks[hookName] = [];
  await new Promise<void>((resolve, reject) => {
    pluginDefs.hooks[hookName].push({
      hook_fn: async (hookName: string, context:any) => {
        if (checkFn == null) return;
        logger.debug(`hook ${hookName} invoked`);
        try {
          // Make sure checkFn is called only once.
          const _checkFn = checkFn;
          // @ts-ignore
          checkFn = null;
          await _checkFn(context);
        } catch (err) {
          reject(err);
          return;
        }
        resolve();
      },
    });
  });
};

const sendMessage = (socket: any, data:any) => {
  socket.emit('message', {
    type: 'COLLABROOM',
    component: 'pad',
    data,
  });
};

const sendChat = (socket:any, message:{
    text: string,

}) => sendMessage(socket, {type: 'CHAT_MESSAGE', message});

describe(__filename, function () {
  const padId = 'testChatPad';
  const hooksBackup:MapArrayType<PluginDef[]> = {};

  before(async function () {
    for (const [name, defs] of Object.entries(pluginDefs.hooks)) {
      if (defs == null) continue;
      hooksBackup[name] = defs as PluginDef[];
    }
  });

  beforeEach(async function () {
    for (const [name, defs] of Object.entries(hooksBackup)) pluginDefs.hooks[name] = [...defs];
    for (const name of Object.keys(pluginDefs.hooks)) {
      if (hooksBackup[name] == null) delete pluginDefs.hooks[name];
    }
    if (await padManager.doesPadExist(padId)) {
      const pad = await padManager.getPad(padId);
      await pad.remove();
    }
  });

  after(async function () {
    Object.assign(pluginDefs.hooks, hooksBackup);
    for (const name of Object.keys(pluginDefs.hooks)) {
      if (hooksBackup[name] == null) delete pluginDefs.hooks[name];
    }
  });

  describe('chatNewMessage hook', function () {
    let authorId: string;
    let socket: any;

    beforeEach(async function () {
      socket = await common.connect();
      const {data: clientVars} = await common.handshake(socket, padId);
      authorId = clientVars.userId;
    });

    afterEach(async function () {
      socket.close();
    });

    it('message', async function () {
      const start = Date.now();
      await Promise.all([
        checkHook('chatNewMessage', ({message}) => {
          assert(message != null);
          assert(message instanceof ChatMessage);
          // @ts-ignore
          assert.equal(message!.authorId, authorId);
          // @ts-ignore
          assert.equal(message!.text, this.test!.title);
          // @ts-ignore
          assert(message!.time >= start);
          // @ts-ignore
          assert(message!.time <= Date.now());
        }),
        sendChat(socket, {text: this.test!.title}),
      ]);
    });

    it('pad', async function () {
      await Promise.all([
        checkHook('chatNewMessage', ({pad}) => {
          assert(pad != null);
          assert(pad instanceof Pad);
          assert.equal(pad.id, padId);
        }),
        sendChat(socket, {text: this.test!.title}),
      ]);
    });

    it('padId', async function () {
      await Promise.all([
        checkHook('chatNewMessage', (context) => {
          assert.equal(context.padId, padId);
        }),
        sendChat(socket, {text: this.test!.title}),
      ]);
    });

    it('mutations propagate', async function () {

      type Message = {
        type: string,
        data: any,
      }

      const listen = async (type: string) => await new Promise<any>((resolve) => {
        const handler = (msg:Message) => {
          if (msg.type !== 'COLLABROOM') return;
          if (msg.data == null || msg.data.type !== type) return;
          resolve(msg.data);
          socket.off('message', handler);
        };
        socket.on('message', handler);
      });

      const modifiedText = `${this.test!.title} <added changes>`;
      const customMetadata = {foo: this.test!.title};
      await Promise.all([
        checkHook('chatNewMessage', ({message}) => {
          // @ts-ignore
          message.text = modifiedText;
          // @ts-ignore
          message.customMetadata = customMetadata;
        }),
        (async () => {
          const {message} = await listen('CHAT_MESSAGE');
          assert(message != null);
          assert.equal(message.text, modifiedText);
          assert.deepEqual(message.customMetadata, customMetadata);
        })(),
        sendChat(socket, {text: this.test!.title}),
      ]);
      // Simulate fetch of historical chat messages when a pad is first loaded.
      await Promise.all([
        (async () => {
          const {messages: [message]} = await listen('CHAT_MESSAGES');
          assert(message != null);
          assert.equal(message.text, modifiedText);
          assert.deepEqual(message.customMetadata, customMetadata);
        })(),
        sendMessage(socket, {type: 'GET_CHAT_MESSAGES', start: 0, end: 0}),
      ]);
    });
  });
});
