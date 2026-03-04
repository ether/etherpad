'use strict';

describe('chat hooks', function () {
  let ChatMessage;
  let hooks;
  const hooksBackup = {};
  let padId;

  const loadPad = async (opts = {}) => {
    padId = await helper.aNewPad(opts);
    ChatMessage = helper.padChrome$.window.require('ep_etherpad-lite/static/js/ChatMessage');
    ({hooks} = helper.padChrome$.window.require('ep_etherpad-lite/static/js/pluginfw/plugin_defs'));
    for (const [name, defs] of Object.entries(hooks)) {
      hooksBackup[name] = defs;
      hooks[name] = [...defs];
    }
    await helper.showChat();
  };

  before(async function () {
    await loadPad();
  });

  afterEach(async function () {
    for (const [name, defs] of Object.entries(hooksBackup)) hooks[name] = [...defs];
    for (const name of Object.keys(hooks)) {
      if (hooksBackup[name] == null) delete hooks[name];
    }
  });

  const checkHook = async (hookName, checkFn) => {
    if (hooks[hookName] == null) hooks[hookName] = [];
    await new Promise((resolve, reject) => {
      hooks[hookName].push({
        hook_fn: async (hookName, context) => {
          if (checkFn == null) return;
          try {
            // Make sure checkFn is called only once.
            const _checkFn = checkFn;
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

  describe('chatNewMessage', function () {
    for (const [desc, msg, wantRegEx] of [
      ['HTML is escaped', '<script>alert("foo");</script>', /^[^<]*$/],
      ['URL becomes a link', 'https://etherpad.org', /<a [^>]*href/],
    ]) {
      it(`text processing: ${desc}`, async function () {
        await Promise.all([
          checkHook('chatNewMessage', ({text}) => {
            expect(text).to.match(wantRegEx);
          }),
          helper.sendChatMessage(`${msg}{enter}`),
        ]);
      });
    }

    it('message is a ChatMessage object', async function () {
      await Promise.all([
        checkHook('chatNewMessage', ({message}) => {
          expect(message).to.be.a(ChatMessage);
        }),
        helper.sendChatMessage(`${this.test.title}{enter}`),
      ]);
    });

    it('message.text is not processed', async function () {
      const msg = '<script>alert("foo");</script> https://etherpad.org';
      await Promise.all([
        checkHook('chatNewMessage', ({message: {text}}) => {
          expect(text).to.equal(`${msg}\n`);
        }),
        helper.sendChatMessage(`${msg}{enter}`),
      ]);
    });

    it('`rendered` overrides default rendering', async function () {
      let rendered;
      await Promise.all([
        checkHook('chatNewMessage', (context) => {
          expect(context.rendered == null).to.be.ok();
          rendered = context.rendered = helper.padChrome$.document.createElement('p');
          rendered.append('message rendering overridden');
        }),
        helper.sendChatMessage(`${this.test.title}{enter}`),
      ]);
      expect(helper.chatTextParagraphs().last()[0]).to.be(rendered);
    });
  });

  describe('chatSendMessage', function () {
    it('message is a ChatMessage object', async function () {
      await Promise.all([
        checkHook('chatSendMessage', ({message}) => {
          expect(message).to.be.a(ChatMessage);
        }),
        helper.sendChatMessage(`${this.test.title}{enter}`),
      ]);
    });

    it('message metadata propagates end-to-end', async function () {
      const metadata = {foo: this.test.title};
      await Promise.all([
        checkHook('chatSendMessage', ({message}) => {
          message.customMetadata = metadata;
        }),
        checkHook('chatNewMessage', ({message: {customMetadata}}) => {
          expect(JSON.stringify(customMetadata)).to.equal(JSON.stringify(metadata));
        }),
        helper.sendChatMessage(`${this.test.title}{enter}`),
      ]);
    });

    it('message metadata is saved in the database', async function () {
      const msg = this.test.title;
      const metadata = {foo: this.test.title};
      await Promise.all([
        checkHook('chatSendMessage', ({message}) => {
          message.customMetadata = metadata;
        }),
        helper.sendChatMessage(`${msg}{enter}`),
      ]);
      let gotMessage;
      const messageP = new Promise((resolve) => gotMessage = resolve);
      await loadPad({
        id: padId,
        hookFns: {
          chatNewMessage: [
            (hookName, {message}) => {
              if (message.text === `${msg}\n`) gotMessage(message);
            },
          ],
        },
      });
      const message = await messageP;
      expect(message).to.be.a(ChatMessage);
      expect(JSON.stringify(message.customMetadata)).to.equal(JSON.stringify(metadata));
    });
  });
});
