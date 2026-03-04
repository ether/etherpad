'use strict';
import {AText, PadType} from "../types/PadType";
import {MapArrayType} from "../types/MapType";

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

import {deserializeOps, splitAttributionLines, subattribution} from '../../static/js/Changeset';
const attributes = require('../../static/js/attributes');
const padManager = require('../db/PadManager');
const _ = require('underscore');
const Security = require('../../static/js/security');
const hooks = require('../../static/js/pluginfw/hooks');
const eejs = require('../eejs');
const _analyzeLine = require('./ExportHelper')._analyzeLine;
const _encodeWhitespace = require('./ExportHelper')._encodeWhitespace;
import padutils from "../../static/js/pad_utils";
import {StringIterator} from "../../static/js/StringIterator";
import {StringAssembler} from "../../static/js/StringAssembler";

const getPadHTML = async (pad: PadType, revNum: string) => {
  let atext = pad.atext;

  // fetch revision atext
  if (revNum !== undefined) {
    atext = await pad.getInternalRevisionAText(revNum);
  }

  // convert atext to html
  return await getHTMLFromAtext(pad, atext);
};

const getHTMLFromAtext = async (pad:PadType, atext: AText, authorColors?: string[]) => {
  const apool = pad.apool();
  const textLines = atext.text.slice(0, -1).split('\n');
  const attribLines = splitAttributionLines(atext.attribs, atext.text);

  const tags = ['h1', 'h2', 'strong', 'em', 'u', 's'];
  const props = ['heading1', 'heading2', 'bold', 'italic', 'underline', 'strikethrough'];

  await Promise.all([
    // prepare tags stored as ['tag', true] to be exported
    hooks.aCallAll('exportHtmlAdditionalTags', pad).then((newProps: string[]) => {
      newProps.forEach((prop) => {
        tags.push(prop);
        props.push(prop);
      });
    }),
    // prepare tags stored as ['tag', 'value'] to be exported. This will generate HTML with tags
    // like <span data-tag="value">
    hooks.aCallAll('exportHtmlAdditionalTagsWithData', pad).then((newProps: string[]) => {
      newProps.forEach((prop) => {
        tags.push(`span data-${prop[0]}="${prop[1]}"`);
        props.push(prop);
      });
    }),
  ]);

  // holds a map of used styling attributes (*1, *2, etc) in the apool
  // and maps them to an index in props
  // *3:2 -> the attribute *3 means strong
  // *2:5 -> the attribute *2 means s(trikethrough)
  const anumMap:MapArrayType<number> = {};
  let css = '';

  const stripDotFromAuthorID = (id: string) => id.replace(/\./g, '_');

  if (authorColors) {
    css += '<style>\n';

    for (const a of Object.keys(apool.numToAttrib)) {
      // @ts-ignore
      const attr = apool.numToAttrib[a];

      // skip non author attributes
      if (attr[0] === 'author' && attr[1] !== '') {
        // add to props array
        const propName = `author${stripDotFromAuthorID(attr[1])}`;
        const newLength = props.push(propName);
        anumMap[a] = newLength - 1;

        css += `.${propName} {background-color: ${authorColors[attr[1]]}}\n`;
      } else if (attr[0] === 'removed') {
        const propName = 'removed';
        const newLength = props.push(propName);
        anumMap[a] = newLength - 1;

        css += '.removed {text-decoration: line-through; ' +
             "-ms-filter:'progid:DXImageTransform.Microsoft.Alpha(Opacity=80)'; " +
             'filter: alpha(opacity=80); ' +
             'opacity: 0.8; ' +
             '}\n';
      }
    }

    css += '</style>';
  }

  // iterates over all props(h1,h2,strong,...), checks if it is used in
  // this pad, and if yes puts its attrib id->props value into anumMap
  props.forEach((propName, i) => {
    let attrib = [propName, true];
    if (Array.isArray(propName)) {
      // propName can be in the form of ['color', 'red'],
      // see hook exportHtmlAdditionalTagsWithData
      attrib = propName;
    }
    // @ts-ignore
    const propTrueNum = apool.putAttrib(attrib, true);
    if (propTrueNum >= 0) {
      anumMap[propTrueNum] = i;
    }
  });

  const getLineHTML = (text: string, attribs: string[]) => {
    // Use order of tags (b/i/u) as order of nesting, for simplicity
    // and decent nesting.  For example,
    // <b>Just bold<b> <b><i>Bold and italics</i></b> <i>Just italics</i>
    // becomes
    // <b>Just bold <i>Bold and italics</i></b> <i>Just italics</i>
    const taker = new StringIterator(text);
    const assem = new StringAssembler();
    const openTags:string[] = [];

    const getSpanClassFor = (i: string) => {
      // return if author colors are disabled
      if (!authorColors) return false;

      // @ts-ignore
      const property = props[i];

      // we are not insterested on properties in the form of ['color', 'red'],
      // see hook exportHtmlAdditionalTagsWithData
      if (Array.isArray(property)) {
        return false;
      }

      if (property.substr(0, 6) === 'author') {
        return stripDotFromAuthorID(property);
      }

      if (property === 'removed') {
        return 'removed';
      }

      return false;
    };

    // tags added by exportHtmlAdditionalTagsWithData will be exported as <span> with
    // data attributes
    const isSpanWithData = (i: string) => {
      // @ts-ignore
      const property = props[i];
      return Array.isArray(property);
    };

    const emitOpenTag = (i: string) => {
      openTags.unshift(i);
      const spanClass = getSpanClassFor(i);

      if (spanClass) {
        assem.append('<span class="');
        assem.append(spanClass);
        assem.append('">');
      } else {
        assem.append('<');
        // @ts-ignore
        assem.append(tags[i]);
        assem.append('>');
      }
    };

    // this closes an open tag and removes its reference from openTags
    const emitCloseTag = (i: string) => {
      openTags.shift();
      const spanClass = getSpanClassFor(i);
      const spanWithData = isSpanWithData(i);

      if (spanClass || spanWithData) {
        assem.append('</span>');
      } else {
        assem.append('</');
        // @ts-ignore
        assem.append(tags[i]);
        assem.append('>');
      }
    };

    const urls = padutils.findURLs(text);

    let idx = 0;

    const processNextChars = (numChars: number) => {
      if (numChars <= 0) {
        return;
      }

      // @ts-ignore
      const ops = deserializeOps(subattribution(attribs, idx, idx + numChars));
      idx += numChars;

      // this iterates over every op string and decides which tags to open or to close
      // based on the attribs used
      for (const o of ops) {
        const usedAttribs:string[] = [];

        // mark all attribs as used
        for (const a of attributes.decodeAttribString(o.attribs)) {
          if (a in anumMap) {
            usedAttribs.push(String(anumMap[a])); // i = 0 => bold, etc.
          }
        }
        let outermostTag = -1;
        // find the outer most open tag that is no longer used
        for (let i = openTags.length - 1; i >= 0; i--) {
          if (usedAttribs.indexOf(openTags[i]) === -1) {
            outermostTag = i;
            break;
          }
        }

        // close all tags upto the outer most
        if (outermostTag !== -1) {
          while (outermostTag >= 0) {
            emitCloseTag(openTags[0]);
            outermostTag--;
          }
        }

        // open all tags that are used but not open
        for (let i = 0; i < usedAttribs.length; i++) {
          if (openTags.indexOf(usedAttribs[i]) === -1) {
            emitOpenTag(usedAttribs[i]);
          }
        }

        let chars = o.chars;
        if (o.lines) {
          chars--; // exclude newline at end of line, if present
        }

        let s = taker.take(chars);

        // removes the characters with the code 12. Don't know where they come
        // from but they break the abiword parser and are completly useless
        s = s.replace(String.fromCharCode(12), '');

        assem.append(_encodeWhitespace(Security.escapeHTML(s)));
      } // end iteration over spans in line

      // close all the tags that are open after the last op
      while (openTags.length > 0) {
        emitCloseTag(openTags[0]);
      }
    };
    // end processNextChars
    if (urls) {
      urls.forEach((urlData: [number, {
        length: number,
      }]) => {
        const startIndex = urlData[0];
        const url = urlData[1];
        const urlLength = url.length;
        processNextChars(startIndex - idx);
        // Using rel="noreferrer" stops leaking the URL/location of the exported HTML
        // when clicking links in the document.
        // Not all browsers understand this attribute, but it's part of the HTML5 standard.
        // https://html.spec.whatwg.org/multipage/links.html#link-type-noreferrer
        // Additionally, we do rel="noopener" to ensure a higher level of referrer security.
        // https://html.spec.whatwg.org/multipage/links.html#link-type-noopener
        // https://mathiasbynens.github.io/rel-noopener/
        // https://github.com/ether/etherpad-lite/pull/3636
        assem.append(`<a href="${Security.escapeHTMLAttribute(url)}" rel="noreferrer noopener">`);
        processNextChars(urlLength);
        assem.append('</a>');
      });
    }
    processNextChars(text.length - idx);

    return _processSpaces(assem.toString());
  };
  // end getLineHTML
  const pieces = [css];

  // Need to deal with constraints imposed on HTML lists; can
  // only gain one level of nesting at once, can't change type
  // mid-list, etc.
  // People might use weird indenting, e.g. skip a level,
  // so we want to do something reasonable there.  We also
  // want to deal gracefully with blank lines.
  // => keeps track of the parents level of indentation

  type openList = {
    level: number,
    type: string,
  }

  let openLists: openList[] = [];
  for (let i = 0; i < textLines.length; i++) {
    let context;
    const line = _analyzeLine(textLines[i], attribLines[i], apool);
    const lineContent = getLineHTML(line.text, line.aline);
    // If we are inside a list
    if (line.listLevel) {
      context = {
        line,
        lineContent,
        apool,
        attribLine: attribLines[i],
        text: textLines[i],
        padId: pad.id,
      };
      let prevLine = null;
      let nextLine = null;
      if (i > 0) {
        prevLine = _analyzeLine(textLines[i - 1], attribLines[i - 1], apool);
      }
      if (i < textLines.length) {
        nextLine = _analyzeLine(textLines[i + 1], attribLines[i + 1], apool);
      }
      await hooks.aCallAll('getLineHTMLForExport', context);
      // To create list parent elements
      if ((!prevLine || prevLine.listLevel !== line.listLevel) ||
          (line.listTypeName !== prevLine.listTypeName)) {
        const exists = _.find(openLists, (item:openList) => (
          item.level === line.listLevel && item.type === line.listTypeName));
        if (!exists) {
          let prevLevel = 0;
          if (prevLine && prevLine.listLevel) {
            prevLevel = prevLine.listLevel;
          }
          if (prevLine && line.listTypeName !== prevLine.listTypeName) {
            prevLevel = 0;
          }

          for (let diff = prevLevel; diff < line.listLevel; diff++) {
            openLists.push({level: diff, type: line.listTypeName});
            const prevPiece = pieces[pieces.length - 1];

            if (prevPiece.indexOf('<ul') === 0 ||
                prevPiece.indexOf('<ol') === 0 ||
                prevPiece.indexOf('</li>') === 0) {
              /*
                 uncommenting this breaks nested ols..
                 if the previous item is NOT a ul, NOT an ol OR closing li then close the list
                 so we consider this HTML,
                 I inserted ** where it throws a problem in Example Wrong..
                 <ol><li>one</li><li><ol><li>1.1</li><li><ol><li>1.1.1</li></ol></li></ol>
                 </li><li>two</li></ol>

                 Note that closing the li then re-opening for another li item here is wrong.
                 The correct markup is
                 <ol><li>one<ol><li>1.1<ol><li>1.1.1</li></ol></li></ol></li><li>two</li></ol>

                 Exmaple Right: <ol class="number"><li>one</li><ol start="2" class="number">
                 <li>1.1</li><ol start="3" class="number"><li>1.1.1</li></ol></li></ol>
                 <li>two</li></ol>
                 Example Wrong: <ol class="number"><li>one</li>**</li>**
                 <ol start="2" class="number"><li>1.1</li>**</li>**<ol start="3" class="number">
                 <li>1.1.1</li></ol></li></ol><li>two</li></ol>
                 So it's firing wrong where the current piece is an li and the previous piece is
                 an ol and next piece is an ol
                 So to remedy this we can say if next piece is NOT an OL or UL.
                 // pieces.push("</li>");

              */
              if ((nextLine.listTypeName === 'number') && (nextLine.text === '')) {
                // is the listTypeName check needed here?  null text might be completely fine!
                // TODO Check against Uls
                // don't do anything because the next item is a nested ol openener so
                // we need to keep the li open
              } else {
                pieces.push('<li>');
              }
            }

            if (line.listTypeName === 'number') {
              // We introduce line.start here, this is useful for continuing
              // Ordered list line numbers
              // in case you have a bullet in a list IE you Want
              // 1. hello
              //   * foo
              // 2. world
              // Without this line.start logic it would be
              // 1. hello * foo 1. world because the bullet would kill the OL

              // TODO: This logic could also be used to continue OL with indented content
              // but that's a job for another day....
              if (line.start) {
                pieces.push(`<ol start="${Number(line.start)}" class="${line.listTypeName}">`);
              } else {
                pieces.push(`<ol class="${line.listTypeName}">`);
              }
            } else {
              pieces.push(`<ul class="${line.listTypeName}">`);
            }
          }
        }
      }
      // if we're going up a level we shouldn't be adding..
      if (context.lineContent) {
        pieces.push('<li>', context.lineContent);
      }

      // To close list elements
      if (nextLine &&
          nextLine.listLevel === line.listLevel &&
          line.listTypeName === nextLine.listTypeName) {
        if (context.lineContent) {
          if ((nextLine.listTypeName === 'number') && (nextLine.text === '')) {
            // is the listTypeName check needed here?  null text might be completely fine!
            // TODO Check against Uls
            // don't do anything because the next item is a nested ol openener so we need to
            // keep the li open
          } else {
            pieces.push('</li>');
          }
        }
      }
      if ((!nextLine ||
           !nextLine.listLevel ||
           nextLine.listLevel < line.listLevel) ||
          (line.listTypeName !== nextLine.listTypeName)) {
        let nextLevel = 0;
        if (nextLine && nextLine.listLevel) {
          nextLevel = nextLine.listLevel;
        }
        if (nextLine && line.listTypeName !== nextLine.listTypeName) {
          nextLevel = 0;
        }

        for (let diff = nextLevel; diff < line.listLevel; diff++) {
          openLists = openLists.filter((el) => el.level !== diff && el.type !== line.listTypeName);

          if (pieces[pieces.length - 1].indexOf('</ul') === 0 ||
              pieces[pieces.length - 1].indexOf('</ol') === 0) {
            pieces.push('</li>');
          }

          if (line.listTypeName === 'number') {
            pieces.push('</ol>');
          } else {
            pieces.push('</ul>');
          }
        }
      }
    } else {
      // outside any list, need to close line.listLevel of lists
      context = {
        line,
        lineContent,
        apool,
        attribLine: attribLines[i],
        text: textLines[i],
        padId: pad.id,
      };

      await hooks.aCallAll('getLineHTMLForExport', context);
      pieces.push(context.lineContent, '<br>');
    }
  }

  return pieces.join('');
};

exports.getPadHTMLDocument = async (padId: string, revNum: string, readOnlyId: number) => {
  const pad = await padManager.getPad(padId);

  // Include some Styles into the Head for Export
  let stylesForExportCSS = '';
  const stylesForExport: string[] = await hooks.aCallAll('stylesForExport', padId);
  stylesForExport.forEach((css) => {
    stylesForExportCSS += css;
  });

  let html = await getPadHTML(pad, revNum);

  for (const hookHtml of await hooks.aCallAll('exportHTMLAdditionalContent', {padId})) {
    html += hookHtml;
  }

  return eejs.require('ep_etherpad-lite/templates/export_html.html', {
    body: html,
    padId: Security.escapeHTML(readOnlyId || padId),
    extraCSS: stylesForExportCSS,
  });
};

// copied from ACE
const _processSpaces = (s: string) => {
  const doesWrap = true;
  if (s.indexOf('<') < 0 && !doesWrap) {
    // short-cut
    return s.replace(/ /g, '&nbsp;');
  }
  const parts = [];
  s.replace(/<[^>]*>?| |[^ <]+/g, (m) => {
    parts.push(m);
    return m
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

exports.getPadHTML = getPadHTML;
exports.getHTMLFromAtext = getHTMLFromAtext;
