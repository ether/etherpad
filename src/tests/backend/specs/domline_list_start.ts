'use strict';

/*
 * Regression test for GHSA-f7h5-v9hm-548j.
 *
 * The numbered-list branch of `domline.appendSpan` used to interpolate the
 * line's `start` attribute value into an `<ol start=...>` tag unquoted and
 * unescaped, then assign the result to `node.innerHTML`. The value comes
 * verbatim from the attribute pool, which an attacker can populate via a
 * crafted `.etherpad` import, so a value such as `1><svg/onload=alert(1)>`
 * broke out of the tag and produced a live element -> stored XSS for every
 * viewer of the pad/timeslider.
 */

const assert = require('assert').strict;
const domline = require('../../../static/js/domline').domline;
const {lineAttributeMarker} = require('../../../static/js/linestylefilter');
import jsdom from 'jsdom';

// Build the per-span class string exactly as linestylefilter would for a
// numbered-list line marker carrying the given `start` value.
const listCls = (start: string) =>
  `${lineAttributeMarker} list:number1 start:${start}`;

// Render a single line-marker span through the real domline sink and return
// the resulting DOM node.
const renderLine = (cls: string) => {
  const {window} = new jsdom.JSDOM('<!DOCTYPE html><html><body></body></html>');
  const node = domline.createDomLine(true, false, window, window.document);
  node.clearSpans();
  node.appendSpan('*', cls);
  node.finishUpdate();
  return node.node as HTMLElement;
};

describe(__filename, function () {
  it('does not create a live element from a malicious start value', async function () {
    // Space-free payload: satisfies the `\S+` capture the sink matches on.
    const node = renderLine(listCls('1><svg/onload=alert(document.domain)>'));
    assert.equal(node.querySelector('svg'), null,
      'malicious start value must not be parsed into a live <svg> element');
    assert.ok(!node.innerHTML.includes('<svg'),
      `rendered markup must not contain a raw <svg> tag: ${node.innerHTML}`);
    // The numbered list itself still renders; only the bogus value is dropped.
    assert.ok(node.querySelector('ol'), 'a numbered list should still render');
  });

  it('renders a legitimate integer start value safely', async function () {
    const node = renderLine(listCls('2'));
    const ol = node.querySelector('ol');
    assert.ok(ol, 'a numbered list should render');
    assert.equal(ol!.getAttribute('start'), '2');
  });

  it('coerces a non-integer start value away instead of emitting it', async function () {
    const node = renderLine(listCls('notanumber'));
    const ol = node.querySelector('ol');
    assert.ok(ol, 'a numbered list should still render');
    assert.equal(ol!.getAttribute('start'), null,
      'a non-integer start value must not reach the <ol> start attribute');
  });
});
