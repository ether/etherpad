'use strict';

/*
 * Regression test for GHSA-4mx2-rqx5-2pp6.
 *
 * linestylefilter builds each span's class string as a space-delimited token
 * list, appending attribute-pool values verbatim (`list:${value}`,
 * `start:${value}`). domline.appendSpan then parses tokens back out of that
 * string and emits any `tag:<name>` token as a raw `<name>` element. Pool
 * values are attacker-controlled (crafted changeset or `.etherpad` import), so
 * a `start` value containing a space could smuggle in a forged
 * `tag:img/src=x/onerror=...` token and produce a live element with a live
 * handler in the pad and the timeslider.
 */

const assert = require('assert').strict;
const AttributePool = require('../../../static/js/AttributePool').default;
const domline = require('../../../static/js/domline').domline;
const linestylefilter = require('../../../static/js/linestylefilter').linestylefilter;
import jsdom from 'jsdom';

const PAYLOAD = 'tag:img/src="x"/onerror=document.title="pwned"';

const newDomLine = () => {
  const {window} = new jsdom.JSDOM('<!DOCTYPE html><html><body></body></html>');
  return domline.createDomLine(true, false, window, window.document);
};

// Render one line of text carrying the given attributes through the real
// linestylefilter -> domline pipeline (the path the timeslider uses).
const renderWithAttribs = (text: string, attribs: [string, string][]) => {
  const apool = new AttributePool();
  const nums = attribs.map((a) => apool.putAttrib(a));
  const aline = `${nums.map((n) => `*${n.toString(36)}`).join('')}+${text.length}|1+1`;
  const domLine = newDomLine();
  linestylefilter.populateDomLine(`${text}\n`, aline, apool, domLine);
  domLine.finishUpdate();
  return domLine.node as HTMLElement;
};

// Render a single span with a hand-built class string straight into domline.
const renderCls = (txt: string, cls: string) => {
  const domLine = newDomLine();
  domLine.clearSpans();
  domLine.appendSpan(txt, cls);
  domLine.finishUpdate();
  return domLine.node as HTMLElement;
};

describe(__filename, function () {
  it('a start value containing a space cannot forge a tag: token', async function () {
    const node = renderWithAttribs('hello', [['start', `1 ${PAYLOAD}`]]);
    assert.equal(node.querySelector('img'), null,
        `forged tag must not render as a live element: ${node.innerHTML}`);
    assert.equal(node.querySelector('[onerror]'), null,
        `no element may carry the handler: ${node.innerHTML}`);
    assert.equal(node.textContent, 'hello');
  });

  it('a list value containing a space cannot forge a tag: token', async function () {
    const node = renderWithAttribs('hello', [['list', `bullet1 ${PAYLOAD}`]]);
    assert.equal(node.querySelector('img'), null,
        `forged tag must not render as a live element: ${node.innerHTML}`);
    assert.equal(node.querySelector('[onerror]'), null, node.innerHTML);
  });

  it('domline drops a tag: token that is not a bare element name', async function () {
    // Defence in depth for class strings contributed by plugin hooks.
    const node = renderCls('hello', `author-a ${PAYLOAD}`);
    assert.equal(node.querySelector('img'), null,
        `non-bare tag name must not render: ${node.innerHTML}`);
    assert.equal(node.querySelector('[onerror]'), null, node.innerHTML);
    assert.equal(node.textContent, 'hello');
  });

  it('legitimate tag: tokens still render', async function () {
    const node = renderCls('hello', 'tag:b tag:i');
    assert.ok(node.querySelector('b'), node.innerHTML);
    assert.ok(node.querySelector('i'), node.innerHTML);
  });

  it('legitimate numbered list with a start value still renders', async function () {
    const domLine = newDomLine();
    const apool = new AttributePool();
    const n = [
      apool.putAttrib(['lmkr', '1']),
      apool.putAttrib(['list', 'number1']),
      apool.putAttrib(['start', '3']),
    ];
    const aline = `${n.map((x) => `*${x.toString(36)}`).join('')}+1+5|1+1`;
    linestylefilter.populateDomLine('*hello\n', aline, apool, domLine);
    domLine.finishUpdate();
    const ol = (domLine.node as HTMLElement).querySelector('ol');
    assert.ok(ol, (domLine.node as HTMLElement).innerHTML);
    assert.equal(ol!.getAttribute('start'), '3');
  });
});
