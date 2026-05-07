'use strict';

import {PadType} from "../../../node/types/PadType";

const Pad = require('../../../node/db/Pad');
import { strict as assert } from 'assert';
import {MapArrayType} from "../../../node/types/MapType";
const authorManager = require('../../../node/db/AuthorManager');
const common = require('../common');
const padManager = require('../../../node/db/PadManager');
const plugins = require('../../../static/js/pluginfw/plugin_defs');
import settings from '../../../node/utils/Settings';

describe(__filename, function () {
  const backups:MapArrayType<any> = {};
  let pad: PadType|null;
  let padId: string;

  before(async function () {
    backups.hooks = {
      padDefaultContent: plugins.hooks.padDefaultContent,
    };
    backups.defaultPadText = settings.defaultPadText;
  });

  beforeEach(async function () {
    backups.hooks.padDefaultContent = [];
    padId = common.randomString();
    assert(!(await padManager.doesPadExist(padId)));
  });

  afterEach(async function () {
    Object.assign(plugins.hooks, backups.hooks);
    if (pad != null) await pad.remove();
    pad = null;
  });

  describe('cleanText', function () {
    const testCases = [
      ['', ''],
      ['\n', '\n'],
      ['x', 'x'],
      ['x\n', 'x\n'],
      ['x\ny\n', 'x\ny\n'],
      ['x\ry\n', 'x\ny\n'],
      ['x\r\ny\n', 'x\ny\n'],
      ['x\r\r\ny\n', 'x\n\ny\n'],
      // Non-breaking space (U+00A0) must survive cleanText (issue #3037).
      ['100\u00a0km\n', '100\u00a0km\n'],
      ['a\u00a0\u00a0b\n', 'a\u00a0\u00a0b\n'],
    ];
    for (const [input, want] of testCases) {
      it(`${JSON.stringify(input)} -> ${JSON.stringify(want)}`, async function () {
        assert.equal(Pad.cleanText(input), want);
      });
    }
  });

  describe('non-breaking space preservation (issue #3037)', function () {
    it('spliceText round-trips U+00A0', async function () {
      pad = await padManager.getPad(padId, '');
      // spliceText is an existing runtime Pad method; cast avoids
      // adding a type-only declaration to PadType in this PR.
      await (pad as any).spliceText(0, 0, '100\u00a0km');
      assert.equal(pad!.text(), '100\u00a0km\n');
    });

    it('setText round-trips U+00A0', async function () {
      pad = await padManager.getPad(padId, '');
      await pad!.setText('a\u00a0b\n');
      assert.equal(pad!.text(), 'a\u00a0b\n');
    });
  });

  describe('padDefaultContent hook', function () {
    it('runs when a pad is created without specific text', async function () {
      const p = new Promise<void>((resolve) => {
        plugins.hooks.padDefaultContent.push({hook_fn: () => resolve()});
      });
      pad = await padManager.getPad(padId);
      await p;
    });

    it('not run if pad is created with specific text', async function () {
      plugins.hooks.padDefaultContent.push(
          {hook_fn: () => { throw new Error('should not be called'); }});
      pad = await padManager.getPad(padId, '');
    });

    it('defaults to settings.defaultPadText', async function () {
      const p = new Promise<void>((resolve, reject) => {
        plugins.hooks.padDefaultContent.push({hook_fn: async (hookName:string, ctx:any) => {
          try {
            assert.equal(ctx.type, 'text');
            assert.equal(ctx.content, settings.defaultPadText);
          } catch (err) {
            return reject(err);
          }
          resolve();
        }});
      });
      pad = await padManager.getPad(padId);
      await p;
    });

    it('passes the pad object', async function () {
      const gotP = new Promise((resolve) => {
        plugins.hooks.padDefaultContent.push({hook_fn: async (hookName:string, {pad}:{
            pad: PadType,
          }) => resolve(pad)});
      });
      pad = await padManager.getPad(padId);
      assert.equal(await gotP, pad);
    });

    it('passes empty authorId if not provided', async function () {
      const gotP = new Promise((resolve) => {
        plugins.hooks.padDefaultContent.push(
            {hook_fn: async (hookName:string, {authorId}:{
                authorId: string,
              }) => resolve(authorId)});
      });
      pad = await padManager.getPad(padId);
      assert.equal(await gotP, '');
    });

    it('passes provided authorId', async function () {
      const want = await authorManager.getAuthor4Token(`t.${padId}`);
      const gotP = new Promise((resolve) => {
        plugins.hooks.padDefaultContent.push(
            {hook_fn: async (hookName: string, {authorId}:{
                authorId: string,
              }) => resolve(authorId)});
      });
      pad = await padManager.getPad(padId, null, want);
      assert.equal(await gotP, want);
    });

    it('uses provided content', async function () {
      const want = 'hello world';
      assert.notEqual(want, settings.defaultPadText);
      plugins.hooks.padDefaultContent.push({hook_fn: async (hookName:string, ctx:any) => {
        ctx.type = 'text';
        ctx.content = want;
      }});
      pad = await padManager.getPad(padId);
      assert.equal(pad!.text(), `${want}\n`);
    });

    it('cleans provided content', async function () {
      const input = 'foo\r\nbar\r\tbaz';
      const want = 'foo\nbar\n        baz';
      assert.notEqual(want, settings.defaultPadText);
      plugins.hooks.padDefaultContent.push({hook_fn: async (hookName:string, ctx:any) => {
        ctx.type = 'text';
        ctx.content = input;
      }});
      pad = await padManager.getPad(padId);
      assert.equal(pad!.text(), `${want}\n`);
    });
  });

  describe('normalizePadSettings lang (issue #7586)', function () {
    it('defaults lang to null when not provided, so client auto-detects locale', function () {
      const ps = Pad.Pad.normalizePadSettings({});
      assert.equal(ps.lang, null);
    });

    it('preserves an explicit string lang (creator override)', function () {
      const ps = Pad.Pad.normalizePadSettings({lang: 'de'});
      assert.equal(ps.lang, 'de');
    });

    it('drops non-string lang values to null rather than coercing to "en"', function () {
      for (const bogus of [42, true, {}, [], null, undefined]) {
        const ps = Pad.Pad.normalizePadSettings({lang: bogus});
        assert.equal(ps.lang, null, `bogus input ${JSON.stringify(bogus)}`);
      }
    });
  });

  describe('normalizePadSettings plugin passthrough (ep_* keys)', function () {
    it('preserves ep_* keys verbatim so plugins can ride padoptions', function () {
      const ps: any = Pad.Pad.normalizePadSettings({
        ep_table_of_contents: {enabled: true, depth: 3},
        ep_font_color: 'red',
      });
      assert.deepEqual(ps.ep_table_of_contents, {enabled: true, depth: 3});
      assert.equal(ps.ep_font_color, 'red');
    });

    it('drops keys that do not match the ep_<lowercase> pattern', function () {
      const ps: any = Pad.Pad.normalizePadSettings({
        EP_SHOUTY: 1,        // uppercase rejected
        ep_: 1,              // empty suffix rejected
        'ep-dashy': 1,       // dash rejected
        somethingElse: 1,    // no prefix rejected
      });
      assert.equal(ps.EP_SHOUTY, undefined);
      assert.equal(ps.ep_, undefined);
      assert.equal(ps['ep-dashy'], undefined);
      assert.equal(ps.somethingElse, undefined);
    });

    it('does not overwrite reserved core keys when an ep_<core> alias is sent', function () {
      // Core keys (showChat etc.) come first; ep_* loop runs after. A plugin
      // key like ep_showchat is namespaced separately and cannot collide.
      const ps: any = Pad.Pad.normalizePadSettings({
        showChat: false,
        ep_showchat: 'plugin-value',
      });
      assert.equal(ps.showChat, false);
      assert.equal(ps.ep_showchat, 'plugin-value');
    });
  });
});
