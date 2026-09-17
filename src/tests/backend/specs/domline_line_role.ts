'use strict';

/*
 * #7778: plain pad lines are exposed to assistive technology as paragraphs so
 * screen readers can step through the pad line by line. Lines whose markup
 * already has block semantics (lists, headings) keep those instead, while
 * inline or styling-only plugin wrappers must not suppress the paragraph role.
 */

const assert = require('assert').strict;
const domline = require('../../../static/js/domline').domline;
const {lineAttributeMarker} = require('../../../static/js/linestylefilter');
const plugins = require('../../../static/js/pluginfw/plugin_defs');
import jsdom from 'jsdom';

const hookName = 'aceDomLineProcessLineAttributes';

const renderLine = (cls: string, text = 'hello') => {
  const {window} = new jsdom.JSDOM('<!DOCTYPE html><html><body></body></html>');
  const line = domline.createDomLine(true, false, window, window.document);
  line.clearSpans();
  line.appendSpan(text, cls);
  line.finishUpdate();
  return line.node as HTMLElement;
};

const setWrapperHook = (preHtml: string, postHtml: string) => {
  plugins.hooks[hookName] = [{
    hook_name: hookName,
    hook_fn: (hn: string, ctx: any) => (ctx.cls.includes('testwrap')
      ? [{preHtml, postHtml, processedMarker: true}] : []),
    hook_fn_name: 'domline_line_role_test',
    part: {plugin: 'testPluginName'},
  }];
};

describe(__filename, function () {
  let savedHooks: any;
  beforeEach(function () { savedHooks = plugins.hooks[hookName]; });
  afterEach(function () {
    if (savedHooks === undefined) delete plugins.hooks[hookName];
    else plugins.hooks[hookName] = savedHooks;
  });

  it('exposes a plain line as a paragraph', async function () {
    const node = renderLine('');
    assert.equal(node.getAttribute('role'), 'paragraph');
  });

  it('does not add a paragraph role to list lines', async function () {
    const node = renderLine(`${lineAttributeMarker} list:bullet1`, '*');
    assert.ok(node.querySelector('ul li'));
    assert.equal(node.getAttribute('role'), null);
  });

  it('does not add a paragraph role to heading lines from plugins', async function () {
    setWrapperHook('<h1>', '</h1>');
    const node = renderLine(`${lineAttributeMarker} testwrap`, '*');
    assert.ok(node.querySelector('h1'));
    assert.equal(node.getAttribute('role'), null);
  });

  it('keeps the paragraph role for inline/styling-only plugin wrappers', async function () {
    setWrapperHook('<span class="align-center">', '</span>');
    const node = renderLine(`${lineAttributeMarker} testwrap`, '*');
    assert.ok(node.querySelector('span.align-center'));
    assert.equal(node.getAttribute('role'), 'paragraph');
  });
});
