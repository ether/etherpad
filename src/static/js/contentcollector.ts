// @ts-nocheck

'use strict';
/**
 * This code is mostly from the old Etherpad. Please help us to comment this code.
 * This helps other people to understand this code better and helps them to improve it.
 * TL;DR COMMENTS ON THIS FILE ARE HIGHLY APPRECIATED
 */

// THIS FILE IS ALSO AN APPJET MODULE: etherpad.collab.ace.contentcollector
// %APPJET%: import("etherpad.collab.ace.easysync2.Changeset");
// %APPJET%: import("etherpad.admin.plugins");
import Op from "./Op";

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

const _MAX_LIST_LEVEL = 16;

import AttributeMap from './AttributeMap';
import UNorm from 'unorm';
import {subattribution} from './Changeset';
import {SmartOpAssembler} from "./SmartOpAssembler";
const hooks = require('./pluginfw/hooks');

const sanitizeUnicode = (s) => UNorm.nfc(s);
const tagName = (n) => n.tagName && n.tagName.toLowerCase();
// supportedElems are Supported natively within Etherpad and don't require a plugin
const supportedElems = new Set([
  'author',
  'b',
  'bold',
  'br',
  'div',
  'font',
  'i',
  'insertorder',
  'italic',
  'li',
  'lmkr',
  'ol',
  'p',
  'pre',
  'strong',
  's',
  'span',
  'u',
  'ul',
]);

const makeContentCollector = (collectStyles, abrowser, apool, className2Author) => {
  const _blockElems = {
    div: 1,
    p: 1,
    pre: 1,
    li: 1,
  };

  hooks.callAll('ccRegisterBlockElements').forEach((element) => {
    _blockElems[element] = 1;
    supportedElems.add(element);
  });

  const isBlockElement = (n) => !!_blockElems[tagName(n) || ''];

  const textify = (str) => sanitizeUnicode(
      str.replace(/(\n | \n)/g, ' ')
          .replace(/[\n\r ]/g, ' ')
          .replace(/\xa0/g, ' ')
          .replace(/\t/g, '        '));

  const getAssoc = (node, name) => node[`_magicdom_${name}`];

  const lines = (() => {
    const textArray = [];
    const attribsArray = [];
    let attribsBuilder = null;
    const op = new Op('+');
    const self = {
      length: () => textArray.length,
      atColumnZero: () => textArray[textArray.length - 1] === '',
      startNew: () => {
        textArray.push('');
        self.flush(true);
        attribsBuilder = new SmartOpAssembler();
      },
      textOfLine: (i) => textArray[i],
      appendText: (txt, attrString = '') => {
        textArray[textArray.length - 1] += txt;
        op.attribs = attrString;
        op.chars = txt.length;
        attribsBuilder.append(op);
      },
      textLines: () => textArray.slice(),
      attribLines: () => attribsArray,
      // call flush only when you're done
      flush: (withNewline) => {
        if (attribsBuilder) {
          attribsArray.push(attribsBuilder.toString());
          attribsBuilder = null;
        }
      },
    };
    self.startNew();
    return self;
  })();
  const cc = {};

  const _ensureColumnZero = (state) => {
    if (!lines.atColumnZero()) {
      cc.startNewLine(state);
    }
  };
  let selection, startPoint, endPoint;
  let selStart = [-1, -1];
  let selEnd = [-1, -1];
  const _isEmpty = (node, state) => {
    // consider clean blank lines pasted in IE to be empty
    if (node.childNodes.length === 0) return true;
    if (node.childNodes.length === 1 &&
        getAssoc(node, 'shouldBeEmpty') &&
        node.innerHTML === '&nbsp;' &&
        !getAssoc(node, 'unpasted')) {
      if (state) {
        const child = node.childNodes[0];
        _reachPoint(child, 0, state);
        _reachPoint(child, 1, state);
      }
      return true;
    }
    return false;
  };

  const _pointHere = (charsAfter, state) => {
    const ln = lines.length() - 1;
    let chr = lines.textOfLine(ln).length;
    if (chr === 0 && Object.keys(state.lineAttributes).length !== 0) {
      chr += 1; // listMarker
    }
    chr += charsAfter;
    return [ln, chr];
  };

  const _reachBlockPoint = (nd, idx, state) => {
    if (nd.nodeType !== nd.TEXT_NODE) _reachPoint(nd, idx, state);
  };

  const _reachPoint = (nd, idx, state) => {
    if (startPoint && nd === startPoint.node && startPoint.index === idx) {
      selStart = _pointHere(0, state);
    }
    if (endPoint && nd === endPoint.node && endPoint.index === idx) {
      selEnd = _pointHere(0, state);
    }
  };
  cc.incrementFlag = (state, flagName) => {
    state.flags[flagName] = (state.flags[flagName] || 0) + 1;
  };
  cc.decrementFlag = (state, flagName) => {
    state.flags[flagName]--;
  };
  cc.incrementAttrib = (state, attribName) => {
    if (!state.attribs[attribName]) {
      state.attribs[attribName] = 1;
    } else {
      state.attribs[attribName]++;
    }
    _recalcAttribString(state);
  };
  cc.decrementAttrib = (state, attribName) => {
    state.attribs[attribName]--;
    _recalcAttribString(state);
  };

  const _enterList = (state, listType) => {
    if (!listType) return;
    const oldListType = state.lineAttributes.list;
    if (listType !== 'none') {
      state.listNesting = (state.listNesting || 0) + 1;
      // reminder that listType can be "number2", "number3" etc.
      if (listType.indexOf('number') !== -1) {
        state.start = (state.start || 0) + 1;
      }
    }

    if (listType === 'none') {
      delete state.lineAttributes.list;
    } else {
      state.lineAttributes.list = listType;
    }
    _recalcAttribString(state);
    return oldListType;
  };

  const _exitList = (state, oldListType) => {
    if (state.lineAttributes.list) {
      state.listNesting--;
    }
    if (oldListType && oldListType !== 'none') {
      state.lineAttributes.list = oldListType;
    } else {
      delete state.lineAttributes.list;
      delete state.lineAttributes.start;
    }
    _recalcAttribString(state);
  };

  const _enterAuthor = (state, author) => {
    const oldAuthor = state.author;
    state.authorLevel = (state.authorLevel || 0) + 1;
    state.author = author;
    _recalcAttribString(state);
    return oldAuthor;
  };

  const _exitAuthor = (state, oldAuthor) => {
    state.authorLevel--;
    state.author = oldAuthor;
    _recalcAttribString(state);
  };

  const _recalcAttribString = (state) => {
    const attribs = new AttributeMap(apool);
    for (const [a, count] of Object.entries(state.attribs)) {
      if (!count) continue;
      // The following splitting of the attribute name is a workaround
      // to enable the content collector to store key-value attributes
      // see https://github.com/ether/etherpad-lite/issues/2567 for more information
      // in long term the contentcollector should be refactored to get rid of this workaround
      //
      // TODO: This approach doesn't support changing existing values: if both 'foo::bar' and
      // 'foo::baz' are in state.attribs then the last one encountered while iterating will win.
      const ATTRIBUTE_SPLIT_STRING = '::';

      // see if attributeString is splittable
      const attributeSplits = a.split(ATTRIBUTE_SPLIT_STRING);
      if (attributeSplits.length > 1) {
        // the attribute name follows the convention key::value
        // so save it as a key value attribute
        const [k, v] = attributeSplits;
        if (v) attribs.set(k, v);
      } else {
        // the "normal" case, the attribute is just a switch
        // so set it true
        attribs.set(a, 'true');
      }
    }
    if (state.authorLevel > 0) {
      if (apool.putAttrib(['author', state.author], true) >= 0) {
        // require that author already be in pool
        // (don't add authors from other documents, etc.)
        if (state.author) attribs.set('author', state.author);
      }
    }
    state.attribString = attribs.toString();
  };

  const _produceLineAttributesMarker = (state) => {
    // TODO: This has to go to AttributeManager.
    const attribs = new AttributeMap(apool)
        .set('lmkr', '1')
        .set('insertorder', 'first')
        // TODO: Converting all falsy values in state.lineAttributes into removals is awkward.
        // Better would be to never add 0, false, null, or undefined to state.lineAttributes in the
        // first place (I'm looking at you, state.lineAttributes.start).
        .update(Object.entries(state.lineAttributes).map(([k, v]) => [k, v || '']), true);
    lines.appendText('*', attribs.toString());
  };
  cc.startNewLine = (state) => {
    if (state) {
      const atBeginningOfLine = lines.textOfLine(lines.length() - 1).length === 0;
      if (atBeginningOfLine && Object.keys(state.lineAttributes).length !== 0) {
        _produceLineAttributesMarker(state);
      }
    }
    lines.startNew();
  };
  cc.notifySelection = (sel) => {
    if (sel) {
      selection = sel;
      startPoint = selection.startPoint;
      endPoint = selection.endPoint;
    }
  };
  cc.doAttrib = (state, na) => {
    state.localAttribs = (state.localAttribs || []);
    state.localAttribs.push(na);
    cc.incrementAttrib(state, na);
  };
  cc.collectContent = function (node, state) {
    let unsupportedElements = null;
    if (!state) {
      state = {
        flags: { /* name -> nesting counter*/
        },
        localAttribs: null,
        attribs: { /* name -> nesting counter*/
        },
        attribString: '',
        // lineAttributes maintain a map from attributes to attribute values set on a line
        lineAttributes: {
          /*
          example:
          'list': 'bullet1',
          */
        },
        unsupportedElements: new Set(),
      };
      unsupportedElements = state.unsupportedElements;
    }
    const localAttribs = state.localAttribs;
    state.localAttribs = null;
    const isBlock = isBlockElement(node);
    if (!isBlock && node.name && (node.name !== 'body')) {
      if (!supportedElems.has(node.name)) state.unsupportedElements.add(node.name);
    }
    const isEmpty = _isEmpty(node, state);
    if (isBlock) _ensureColumnZero(state);
    const startLine = lines.length() - 1;
    _reachBlockPoint(node, 0, state);

    if (node.nodeType === node.TEXT_NODE) {
      const tname = node.parentNode.getAttribute('name');
      const context = {cc: this, state, tname, node, text: node.nodeValue};
      // Hook functions may either return a string (deprecated) or modify context.text. If any hook
      // function modifies context.text then all returned strings are ignored. If no hook functions
      // modify context.text, the first hook function to return a string wins.
      const [hookTxt] =
          hooks.callAll('collectContentLineText', context).filter((s) => typeof s === 'string');
      let txt = context.text === node.nodeValue && hookTxt != null ? hookTxt : context.text;

      let rest = '';
      let x = 0; // offset into original text
      if (txt.length === 0) {
        if (startPoint && node === startPoint.node) {
          selStart = _pointHere(0, state);
        }
        if (endPoint && node === endPoint.node) {
          selEnd = _pointHere(0, state);
        }
      }
      while (txt.length > 0) {
        let consumed = 0;
        if (state.flags.preMode) {
          const firstLine = txt.split('\n', 1)[0];
          consumed = firstLine.length + 1;
          rest = txt.substring(consumed);
          txt = firstLine;
        } else { /* will only run this loop body once */
        }
        if (startPoint && node === startPoint.node && startPoint.index - x <= txt.length) {
          selStart = _pointHere(startPoint.index - x, state);
        }
        if (endPoint && node === endPoint.node && endPoint.index - x <= txt.length) {
          selEnd = _pointHere(endPoint.index - x, state);
        }
        let txt2 = txt;
        if ((!state.flags.preMode) && /^[\r\n]*$/.exec(txt)) {
          // prevents textnodes containing just "\n" from being significant
          // in safari when pasting text, now that we convert them to
          // spaces instead of removing them, because in other cases
          // removing "\n" from pasted HTML will collapse words together.
          txt2 = '';
        }
        const atBeginningOfLine = lines.textOfLine(lines.length() - 1).length === 0;
        if (atBeginningOfLine) {
          // newlines in the source mustn't become spaces at beginning of line box
          txt2 = txt2.replace(/^\n*/, '');
        }
        if (atBeginningOfLine && Object.keys(state.lineAttributes).length !== 0) {
          _produceLineAttributesMarker(state);
        }
        lines.appendText(textify(txt2), state.attribString);
        x += consumed;
        txt = rest;
        if (txt.length > 0) {
          cc.startNewLine(state);
        }
      }
    } else if (node.nodeType === node.ELEMENT_NODE) {
      const tname = tagName(node) || '';

      if (tname === 'img') {
        hooks.callAll('collectContentImage', {
          cc,
          state,
          tname,
          styl: null,
          cls: null,
          node,
        });
      } else {
        // THIS SEEMS VERY HACKY! -- Please submit a better fix!
        delete state.lineAttributes.img;
      }

      if (tname === 'br') {
        this.breakLine = true;
        const tvalue = node.getAttribute('value');
        const [startNewLine = true] = hooks.callAll('collectContentLineBreak', {
          cc: this,
          state,
          tname,
          tvalue,
          styl: null,
          cls: null,
        });
        if (startNewLine) {
          cc.startNewLine(state);
        }
      } else if (tname === 'script' || tname === 'style') {
        // ignore
      } else if (!isEmpty) {
        let styl = node.getAttribute('style');
        let cls = node.getAttribute('class');
        let isPre = (tname === 'pre');
        if ((!isPre) && abrowser && abrowser.safari) {
          isPre = (styl && /\bwhite-space:\s*pre\b/i.exec(styl));
        }
        if (isPre) cc.incrementFlag(state, 'preMode');
        let oldListTypeOrNull = null;
        let oldAuthorOrNull = null;

        // LibreOffice Writer puts in weird items during import or copy/paste, we should drop them.
        if (cls === 'Numbering_20_Symbols' || cls === 'Bullet_20_Symbols') {
          styl = null;
          cls = null;

          // We have to return here but this could break things in the future,
          // for now it shows how to fix the problem
          return;
        }
        if (collectStyles) {
          hooks.callAll('collectContentPre', {
            cc,
            state,
            tname,
            styl,
            cls,
          });
          if (tname === 'b' ||
              (styl && /\bfont-weight:\s*bold\b/i.exec(styl)) ||
              tname === 'strong') {
            cc.doAttrib(state, 'bold');
          }
          if (tname === 'i' ||
              (styl && /\bfont-style:\s*italic\b/i.exec(styl)) ||
              tname === 'em') {
            cc.doAttrib(state, 'italic');
          }
          if (tname === 'u' ||
              (styl && /\btext-decoration:\s*underline\b/i.exec(styl)) ||
              tname === 'ins') {
            cc.doAttrib(state, 'underline');
          }
          if (tname === 's' ||
              (styl && /\btext-decoration:\s*line-through\b/i.exec(styl)) ||
              tname === 'del') {
            cc.doAttrib(state, 'strikethrough');
          }
          if (tname === 'ul' || tname === 'ol') {
            let type = node.getAttribute('class');
            const rr = cls && /(?:^| )list-([a-z]+[0-9]+)\b/.exec(cls);
            // lists do not need to have a type, so before we make a wrong guess
            // check if we find a better hint within the node's children
            if (!rr && !type) {
              for (const child of node.childNodes) {
                if (tagName(child) !== 'ul') continue;
                type = child.getAttribute('class');
                if (type) break;
              }
            }
            if (rr && rr[1]) {
              type = rr[1];
            } else {
              if (tname === 'ul') {
                const cls = node.getAttribute('class');
                if ((type && type.match('indent')) || (cls && cls.match('indent'))) {
                  type = 'indent';
                } else {
                  type = 'bullet';
                }
              } else {
                type = 'number';
              }
              type += String(Math.min(_MAX_LIST_LEVEL, (state.listNesting || 0) + 1));
            }
            oldListTypeOrNull = (_enterList(state, type) || 'none');
          } else if ((tname === 'div' || tname === 'p') && cls && cls.match(/(?:^| )ace-line\b/)) {
            // This has undesirable behavior in Chrome but is right in other browsers.
            // See https://github.com/ether/etherpad-lite/issues/2412 for reasoning
            if (!abrowser.chrome) oldListTypeOrNull = (_enterList(state, undefined) || 'none');
          } else if (tname === 'li') {
            state.lineAttributes.start = state.start || 0;
            _recalcAttribString(state);
            if (state.lineAttributes.list.indexOf('number') !== -1) {
              /*
               Nested OLs are not --> <ol><li>1</li><ol>nested</ol></ol>
               They are           --> <ol><li>1</li><li><ol><li>nested</li></ol></li></ol>
               Note how the <ol> item has to be inside a <li>
               Because of this we don't increment the start number
              */
              if (node.parentNode && tagName(node.parentNode) !== 'ol') {
                /*
                TODO: start number has to increment based on indentLevel(numberX)
                This means we have to build an object IE
                {
                 1: 4
                 2: 3
                 3: 5
                }
                But the browser seems to handle it fine using CSS..  Why can't we do the same
                with exports?  We can..  But let's leave this comment in because it might be useful
                in the future..
                */
                state.start++; // not if it's parent is an OL or UL.
              }
            }
            // UL list items never modify the start value.
            if (node.parentNode && tagName(node.parentNode) === 'ul') {
              state.start++;
              // TODO, this is hacky.
              // Because if the first item is an UL it will increment a list no?
              // A much more graceful way would be to say, ul increases if it's within an OL
              // But I don't know a way to do that because we're only aware of the previous Line
              // As the concept of parent's doesn't exist when processing each domline...
            }
          } else {
            // Below needs more testin if it's necessary as _exitList should take care of this.
            // delete state.start;
            // delete state.listNesting;
            // _recalcAttribString(state);
          }
          if (className2Author && cls) {
            const classes = cls.match(/\S+/g);
            if (classes && classes.length > 0) {
              for (let i = 0; i < classes.length; i++) {
                const c = classes[i];
                const a = className2Author(c);
                if (a) {
                  oldAuthorOrNull = (_enterAuthor(state, a) || 'none');
                  break;
                }
              }
            }
          }
        }

        for (const c of node.childNodes) {
          cc.collectContent(c, state);
        }

        if (collectStyles) {
          hooks.callAll('collectContentPost', {
            cc,
            state,
            tname,
            styl,
            cls,
          });
        }

        if (isPre) cc.decrementFlag(state, 'preMode');
        if (state.localAttribs) {
          for (let i = 0; i < state.localAttribs.length; i++) {
            cc.decrementAttrib(state, state.localAttribs[i]);
          }
        }
        if (oldListTypeOrNull) {
          _exitList(state, oldListTypeOrNull);
        }
        if (oldAuthorOrNull) {
          _exitAuthor(state, oldAuthorOrNull);
        }
      }
    }
    _reachBlockPoint(node, 1, state);
    if (isBlock) {
      if (lines.length() - 1 === startLine) {
        // added additional check to resolve https://github.com/JohnMcLear/ep_copy_paste_images/issues/20
        // this does mean that images etc can't be pasted on lists but imho that's fine

        // If we're doing an export event we need to start a new lines
        // Export events don't have window available.
        // commented out to solve #2412 - https://github.com/ether/etherpad-lite/issues/2412
        if ((state.lineAttributes && !state.lineAttributes.list) || typeof window === 'undefined') {
          cc.startNewLine(state);
        }
      } else {
        _ensureColumnZero(state);
      }
    }
    state.localAttribs = localAttribs;
    if (unsupportedElements && unsupportedElements.size) {
      console.warn('Ignoring unsupported elements (you might want to install a plugin): ' +
                   `${[...unsupportedElements].join(', ')}`);
    }
  };
  // can pass a falsy value for end of doc
  cc.notifyNextNode = (node) => {
    // an "empty block" won't end a line; this addresses an issue in IE with
    // typing into a blank line at the end of the document.  typed text
    // goes into the body, and the empty line div still looks clean.
    // it is incorporated as dirty by the rule that a dirty region has
    // to end a line.
    if ((!node) || (isBlockElement(node) && !_isEmpty(node))) {
      _ensureColumnZero(null);
    }
  };
  // each returns [line, char] or [-1,-1]
  const getSelectionStart = () => selStart;
  const getSelectionEnd = () => selEnd;

  // returns array of strings for lines found, last entry will be "" if
  // last line is complete (i.e. if a following span should be on a new line).
  // can be called at any point
  cc.getLines = () => lines.textLines();

  cc.finish = () => {
    lines.flush();
    const lineAttribs = lines.attribLines();
    const lineStrings = cc.getLines();

    lineStrings.length--;
    lineAttribs.length--;

    const ss = getSelectionStart();
    const se = getSelectionEnd();

    const fixLongLines = () => {
      // design mode does not deal with with really long lines!
      const lineLimit = 2000; // chars
      const buffer = 10; // chars allowed over before wrapping
      let linesWrapped = 0;
      let numLinesAfter = 0;
      for (let i = lineStrings.length - 1; i >= 0; i--) {
        let oldString = lineStrings[i];
        let oldAttribString = lineAttribs[i];
        if (oldString.length > lineLimit + buffer) {
          const newStrings = [];
          const newAttribStrings = [];
          while (oldString.length > lineLimit) {
            // var semiloc = oldString.lastIndexOf(';', lineLimit-1);
            // var lengthToTake = (semiloc >= 0 ? (semiloc+1) : lineLimit);
            const lengthToTake = lineLimit;
            newStrings.push(oldString.substring(0, lengthToTake));
            oldString = oldString.substring(lengthToTake);
            newAttribStrings.push(subattribution(oldAttribString, 0, lengthToTake));
            oldAttribString = subattribution(oldAttribString, lengthToTake);
          }
          if (oldString.length > 0) {
            newStrings.push(oldString);
            newAttribStrings.push(oldAttribString);
          }

          const fixLineNumber = (lineChar) => {
            if (lineChar[0] < 0) return;
            let n = lineChar[0];
            let c = lineChar[1];
            if (n > i) {
              n += (newStrings.length - 1);
            } else if (n === i) {
              let a = 0;
              while (c > newStrings[a].length) {
                c -= newStrings[a].length;
                a++;
              }
              n += a;
            }
            lineChar[0] = n;
            lineChar[1] = c;
          };
          fixLineNumber(ss);
          fixLineNumber(se);
          linesWrapped++;
          numLinesAfter += newStrings.length;
          lineStrings.splice(i, 1, ...newStrings);
          lineAttribs.splice(i, 1, ...newAttribStrings);
        }
      }
      return {
        linesWrapped,
        numLinesAfter,
      };
    };
    const wrapData = fixLongLines();

    return {
      selStart: ss,
      selEnd: se,
      linesWrapped: wrapData.linesWrapped,
      numLinesAfter: wrapData.numLinesAfter,
      lines: lineStrings,
      lineAttribs,
    };
  };

  return cc;
};

exports.sanitizeUnicode = sanitizeUnicode;
exports.makeContentCollector = makeContentCollector;
exports.supportedElems = supportedElems;
