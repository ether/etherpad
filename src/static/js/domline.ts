// @ts-nocheck
'use strict';

// THIS FILE IS ALSO AN APPJET MODULE: etherpad.collab.ace.domline
// %APPJET%: import("etherpad.admin.plugins");
/**
 * Copyright 2009 Google Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS-IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// requires: top
// requires: plugins
// requires: undefined

const Security = require('./security');
const hooks = require('./pluginfw/hooks');
const _ = require('./underscore');
const lineAttributeMarker = require('./linestylefilter').lineAttributeMarker;
const noop = () => {};


const domline = {};

domline.addToLineClass = (lineClass, cls) => {
  // an "empty span" at any point can be used to add classes to
  // the line, using line:className.  otherwise, we ignore
  // the span.
  cls.replace(/\S+/g, (c) => {
    if (c.indexOf('line:') === 0) {
      // add class to line
      lineClass = (lineClass ? `${lineClass} ` : '') + c.substring(5);
    }
  });
  return lineClass;
};

// if "document" is falsy we don't create a DOM node, just
// an object with innerHTML and className
domline.createDomLine = (nonEmpty, doesWrap, optBrowser, optDocument) => {
  const result = {
    node: null,
    appendSpan: noop,
    prepareForAdd: noop,
    notifyAdded: noop,
    clearSpans: noop,
    finishUpdate: noop,
    lineMarker: 0,
  };

  const document = optDocument;

  if (document) {
    result.node = document.createElement('div');
    // JAWS and NVDA screen reader compatibility. Only needed if in a real browser.
    result.node.setAttribute('aria-live', 'assertive');
  } else {
    result.node = {
      innerHTML: '',
      className: '',
    };
  }

  let html = [];
  let preHtml = '';
  let postHtml = '';
  let curHTML = null;

  const processSpaces = (s) => domline.processSpaces(s, doesWrap);
  const perTextNodeProcess = (doesWrap ? _.identity : processSpaces);
  const perHtmlLineProcess = (doesWrap ? processSpaces : _.identity);
  let lineClass = 'ace-line';

  result.appendSpan = (txt, cls) => {
    let processedMarker = false;
    // Handle lineAttributeMarker, if present
    if (cls.indexOf(lineAttributeMarker) >= 0) {
      let listType = /(?:^| )list:(\S+)/.exec(cls);
      const start = /(?:^| )start:(\S+)/.exec(cls);

      _.map(hooks.callAll('aceDomLinePreProcessLineAttributes', {
        domline,
        cls,
      }), (modifier) => {
        preHtml += modifier.preHtml;
        postHtml += modifier.postHtml;
        processedMarker |= modifier.processedMarker;
      });
      if (listType) {
        listType = listType[1];
        if (listType) {
          if (listType.indexOf('number') < 0) {
            preHtml += `<ul class="list-${Security.escapeHTMLAttribute(listType)}"><li>`;
            postHtml = `</li></ul>${postHtml}`;
          } else {
            if (start) { // is it a start of a list with more than one item in?
              if (Number.parseInt(start[1]) === 1) { // if its the first one at this level?
                // Add start class to DIV node
                lineClass = `${lineClass} ` + `list-start-${listType}`;
              }
              preHtml +=
                `<ol start=${start[1]} class="list-${Security.escapeHTMLAttribute(listType)}"><li>`;
            } else {
              // Handles pasted contents into existing lists
              preHtml += `<ol class="list-${Security.escapeHTMLAttribute(listType)}"><li>`;
            }
            postHtml += '</li></ol>';
          }
        }
        processedMarker = true;
      }
      _.map(hooks.callAll('aceDomLineProcessLineAttributes', {
        domline,
        cls,
      }), (modifier) => {
        preHtml += modifier.preHtml;
        postHtml += modifier.postHtml;
        processedMarker |= modifier.processedMarker;
      });
      if (processedMarker) {
        result.lineMarker += txt.length;
        return; // don't append any text
      }
    }
    let href = null;
    let simpleTags = null;
    if (cls.indexOf('url') >= 0) {
      cls = cls.replace(/(^| )url:(\S+)/g, (x0, space, url) => {
        href = url;
        return `${space}url`;
      });
    }
    if (cls.indexOf('tag') >= 0) {
      cls = cls.replace(/(^| )tag:(\S+)/g, (x0, space, tag) => {
        if (!simpleTags) simpleTags = [];
        simpleTags.push(tag.toLowerCase());
        return space + tag;
      });
    }

    let extraOpenTags = '';
    let extraCloseTags = '';

    _.map(hooks.callAll('aceCreateDomLine', {
      domline,
      cls,
    }), (modifier) => {
      cls = modifier.cls;
      extraOpenTags += modifier.extraOpenTags;
      extraCloseTags = modifier.extraCloseTags + extraCloseTags;
    });

    if ((!txt) && cls) {
      lineClass = domline.addToLineClass(lineClass, cls);
    } else if (txt) {
      if (href) {
        const urn_schemes = new RegExp('^(about|geo|mailto|tel):');
        // if the url doesn't include a protocol prefix, assume http
        if (!~href.indexOf('://') && !urn_schemes.test(href)) {
          href = `http://${href}`;
        }
        // Using rel="noreferrer" stops leaking the URL/location of the pad when
        // clicking links in the document.
        // Not all browsers understand this attribute, but it's part of the HTML5 standard.
        // https://html.spec.whatwg.org/multipage/links.html#link-type-noreferrer
        // Additionally, we do rel="noopener" to ensure a higher level of referrer security.
        // https://html.spec.whatwg.org/multipage/links.html#link-type-noopener
        // https://mathiasbynens.github.io/rel-noopener/
        // https://github.com/ether/etherpad-lite/pull/3636
        const escapedHref = Security.escapeHTMLAttribute(href);
        extraOpenTags = `${extraOpenTags}<a href="${escapedHref}" rel="noreferrer noopener">`;
        extraCloseTags = `</a>${extraCloseTags}`;
      }
      if (simpleTags) {
        simpleTags.sort();
        extraOpenTags = `${extraOpenTags}<${simpleTags.join('><')}>`;
        simpleTags.reverse();
        extraCloseTags = `</${simpleTags.join('></')}>${extraCloseTags}`;
      }
      html.push(
          '<span class="', Security.escapeHTMLAttribute(cls || ''),
          '">',
          extraOpenTags,
          perTextNodeProcess(Security.escapeHTML(txt)),
          extraCloseTags,
          '</span>');
    }
  };
  result.clearSpans = () => {
    html = [];
    lineClass = 'ace-line';
    result.lineMarker = 0;
  };

  const writeHTML = () => {
    let newHTML = perHtmlLineProcess(html.join(''));
    if (!newHTML) {
      if ((!document) || (!optBrowser)) {
        newHTML += '&nbsp;';
      } else {
        newHTML += '<br/>';
      }
    }
    if (nonEmpty) {
      newHTML = (preHtml || '') + newHTML + (postHtml || '');
    }
    html = preHtml = postHtml = ''; // free memory
    if (newHTML !== curHTML) {
      curHTML = newHTML;
      result.node.innerHTML = curHTML;
    }
    if (lineClass != null) result.node.className = lineClass;

    hooks.callAll('acePostWriteDomLineHTML', {
      node: result.node,
    });
  };
  result.prepareForAdd = writeHTML;
  result.finishUpdate = writeHTML;
  return result;
};

domline.processSpaces = (s, doesWrap) => {
  if (s.indexOf('<') < 0 && !doesWrap) {
    // short-cut
    return s.replace(/ /g, '&nbsp;');
  }
  const parts = [];
  s.replace(/<[^>]*>?| |[^ <]+/g, (m) => {
    parts.push(m);
  });
  if (doesWrap) {
    let endOfLine = true;
    let beforeSpace = false;
    // last space in a run is normal, others are nbsp,
    // end of line is nbsp
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      if (p === ' ') {
        if (endOfLine || beforeSpace) parts[i] = '&nbsp;';
        endOfLine = false;
        beforeSpace = true;
      } else if (p.charAt(0) !== '<') {
        endOfLine = false;
        beforeSpace = false;
      }
    }
    // beginning of line is nbsp
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (p === ' ') {
        parts[i] = '&nbsp;';
        break;
      } else if (p.charAt(0) !== '<') {
        break;
      }
    }
  } else {
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (p === ' ') {
        parts[i] = '&nbsp;';
      }
    }
  }
  return parts.join('');
};

exports.domline = domline;
