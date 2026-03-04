// @ts-nocheck
import {Builder} from "./Builder";

/**
 * Copyright 2009 Google Inc.
 * Copyright 2020 John McLear - The Etherpad Foundation.
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
let documentAttributeManager;

import AttributeMap from './AttributeMap';
const browser = require('./vendors/browser');
import padutils from './pad_utils'
const Ace2Common = require('./ace2_common');
const $ = require('./rjquery').$;
import {characterRangeFollow, checkRep, cloneAText, compose, deserializeOps, filterAttribNumbers, inverse, isIdentity, makeAText, makeAttribution, mapAttribNumbers, moveOpsToNewPool, mutateAttributionLines, mutateTextLines, oldLen, opsFromAText, pack, splitAttributionLines} from './Changeset'


const isNodeText = Ace2Common.isNodeText;
const getAssoc = Ace2Common.getAssoc;
const setAssoc = Ace2Common.setAssoc;
const noop = Ace2Common.noop;
const hooks = require('./pluginfw/hooks');
import SkipList from "./skiplist";
import Scroll from './scroll'
import AttribPool from './AttributePool'
import {SmartOpAssembler} from "./SmartOpAssembler";
import Op from "./Op";
import {buildKeepRange, buildKeepToStartOfRange, buildRemoveRange} from './ChangesetUtils'

function Ace2Inner(editorInfo, cssManagers) {
  const makeChangesetTracker = require('./changesettracker').makeChangesetTracker;
  const colorutils = require('./colorutils').colorutils;
  const makeContentCollector = require('./contentcollector').makeContentCollector;
  const domline = require('./domline').domline;
  const linestylefilter = require('./linestylefilter').linestylefilter;
  const undoModule = require('./undomodule').undoModule;
  const AttributeManager = require('./AttributeManager');
  const DEBUG = false;

  const THE_TAB = '    '; // 4
  const MAX_LIST_LEVEL = 16;

  const FORMATTING_STYLES = ['bold', 'italic', 'underline', 'strikethrough'];
  const SELECT_BUTTON_CLASS = 'selected';

  let thisAuthor = '';

  let disposed = false;
  const outerWin = document.getElementsByName("ace_outer")[0]
  const targetDoc = outerWin.contentWindow.document.getElementsByName("ace_inner")[0].contentWindow.document
  const targetBody = targetDoc.body

  const focus = () => {
    targetBody.focus();
  };

  const outerDoc = outerWin.contentWindow.document;

  const sideDiv = outerDoc.getElementById('sidediv');
  const lineMetricsDiv = outerDoc.getElementById('linemetricsdiv');
  const sideDivInner = outerDoc.getElementById('sidedivinner');
  const appendNewSideDivLine = () => {
    const lineDiv = outerDoc.createElement('div');
    sideDivInner.appendChild(lineDiv);
    const lineSpan = outerDoc.createElement('span');
    lineSpan.classList.add('line-number');
    lineSpan.appendChild(outerDoc.createTextNode(sideDivInner.children.length));
    lineDiv.appendChild(lineSpan);
  };
  appendNewSideDivLine();

  const scroll = new Scroll(outerWin);

  let outsideKeyDown = noop;
  let outsideKeyPress = (e) => true;
  let outsideNotifyDirty = noop;

  /**
   * Document representation.
   */
  const rep = {
    /**
     * The contents of the document. Each entry in this skip list is an object representing a
     * line (actually paragraph) of text. The line objects are created by createDomLineEntry().
     */
    lines: new SkipList(),
    /**
     * Start of the selection. Represented as an array of two non-negative numbers that point to the
     * first character of the selection: [zeroBasedLineNumber, zeroBasedColumnNumber]. Notes:
     *   - There is an implicit newline character (not actually stored) at the end of every line.
     *     Because of this, a selection that starts at the end of a line (column number equals the
     *     number of characters in the line, not including the implicit newline) is not equivalent
     *     to a selection that starts at the beginning of the next line. The same goes for the
     *     selection end.
     *   - If there are N lines, [N, 0] is valid for the start of the selection. [N, 0] indicates
     *     that the selection starts just after the implicit newline at the end of the document's
     *     last line (if the document has any lines). The same goes for the end of the selection.
     *   - If a line starts with a line marker, a selection that starts at the beginning of the line
     *     may start either immediately before (column = 0) or immediately after (column = 1) the
     *     line marker, and the two are considered to be semantically equivalent. For safety, all
     *     code should be written to accept either but only produce selections that start after the
     *     line marker (the column number should be 1, not 0, when there is a line marker). The same
     *     goes for the end of the selection.
     */
    selStart: null,
    /**
     * End of the selection. Represented as an array of two non-negative numbers that point to the
     * character just after the end of the selection: [zeroBasedLineNumber, zeroBasedColumnNumber].
     * See the above notes for selStart.
     */
    selEnd: null,
    /**
     * Whether the selection extends "backwards", so that the focus point (controlled with the arrow
     * keys) is at the beginning. This is not supported in IE, though native IE selections have that
     * behavior (which we try not to interfere with). Must be false if selection is collapsed!
     */
    selFocusAtStart: false,
    alltext: '',
    alines: [],
    apool: new AttribPool(),
  };

  // lines, alltext, alines, and DOM are set up in init()
  if (undoModule.enabled) {
    undoModule.apool = rep.apool;
  }

  let isEditable = true;
  let doesWrap = true;
  let hasLineNumbers = true;
  let isStyled = true;

  let console = (DEBUG && window.console);

  if (!window.console) {
    const names = [
      'log',
      'debug',
      'info',
      'warn',
      'error',
      'assert',
      'dir',
      'dirxml',
      'group',
      'groupEnd',
      'time',
      'timeEnd',
      'count',
      'trace',
      'profile',
      'profileEnd',
    ];
    console = {};
    for (const name of names) console[name] = noop;
  }

  const scheduler = window; // hack for opera required

  const performDocumentReplaceRange = (start, end, newText) => {
    if (start === undefined) start = rep.selStart;
    if (end === undefined) end = rep.selEnd;

    // start[0]: <--- start[1] --->CCCCCCCCCCC\n
    //           CCCCCCCCCCCCCCCCCCCC\n
    //           CCCC\n
    // end[0]:   <CCC end[1] CCC>-------\n
    const builder = new Builder(rep.lines.totalWidth());
    buildKeepToStartOfRange(rep, builder, start);
    buildRemoveRange(rep, builder, start, end);
    builder.insert(newText, [
      ['author', thisAuthor],
    ], rep.apool);
    const cs = builder.toString();

    performDocumentApplyChangeset(cs);
  };

  const changesetTracker = makeChangesetTracker(scheduler, rep.apool, {
    withCallbacks: (operationName, f) => {
      inCallStackIfNecessary(operationName, () => {
        fastIncorp(1);
        f(
            {
              setDocumentAttributedText: (atext) => {
                setDocAText(atext);
              },
              applyChangesetToDocument: (changeset, preferInsertionAfterCaret) => {
                const oldEventType = currentCallStack.editEvent.eventType;
                currentCallStack.startNewEvent('nonundoable');

                performDocumentApplyChangeset(changeset, preferInsertionAfterCaret);

                currentCallStack.startNewEvent(oldEventType);
              },
            });
      });
    },
  });

  const authorInfos = {}; // presence of key determines if author is present in doc
  const getAuthorInfos = () => authorInfos;
  editorInfo.ace_getAuthorInfos = getAuthorInfos;

  const setAuthorStyle = (author, info) => {
    const authorSelector = getAuthorColorClassSelector(getAuthorClassName(author));

    const authorStyleSet = hooks.callAll('aceSetAuthorStyle', {
      dynamicCSS: cssManagers.inner,
      outerDynamicCSS: cssManagers.outer,
      parentDynamicCSS: cssManagers.parent,
      info,
      author,
      authorSelector,
    });

    // Prevent default behaviour if any hook says so
    if (authorStyleSet.some((it) => it)) {
      return;
    }

    if (!info) {
      cssManagers.inner.removeSelectorStyle(authorSelector);
      cssManagers.parent.removeSelectorStyle(authorSelector);
    } else if (info.bgcolor) {
      let bgcolor = info.bgcolor;
      if ((typeof info.fade) === 'number') {
        bgcolor = fadeColor(bgcolor, info.fade);
      }
      const textColor =
          colorutils.textColorFromBackgroundColor(bgcolor, window.clientVars.skinName);
      const styles = [
        cssManagers.inner.selectorStyle(authorSelector),
        cssManagers.parent.selectorStyle(authorSelector),
      ];
      for (const style of styles) {
        style.backgroundColor = bgcolor;
        style.color = textColor;
        style['padding-top'] = '3px';
        style['padding-bottom'] = '4px';
      }
    }
  };

  const setAuthorInfo = (author, info) => {
    if (!author) return; // author ID not set for some reason
    if ((typeof author) !== 'string') {
      // Potentially caused by: https://github.com/ether/etherpad-lite/issues/2802");
      throw new Error(`setAuthorInfo: author (${author}) is not a string`);
    }
    if (!info) {
      delete authorInfos[author];
    } else {
      authorInfos[author] = info;
    }
    setAuthorStyle(author, info);
  };

  const getAuthorClassName = (author) => `author-${author.replace(/[^a-y0-9]/g, (c) => {
    if (c === '.') return '-';
    return `z${c.charCodeAt(0)}z`;
  })}`;

  const className2Author = (className) => {
    if (className.substring(0, 7) === 'author-') {
      return className.substring(7).replace(/[a-y0-9]+|-|z.+?z/g, (cc) => {
        if (cc === '-') { return '.'; } else if (cc.charAt(0) === 'z') {
          return String.fromCharCode(Number(cc.slice(1, -1)));
        } else {
          return cc;
        }
      });
    }
    return null;
  };

  const getAuthorColorClassSelector = (oneClassName) => `.authorColors .${oneClassName}`;

  const fadeColor = (colorCSS, fadeFrac) => {
    let color = colorutils.css2triple(colorCSS);
    color = colorutils.blend(color, [1, 1, 1], fadeFrac);
    return colorutils.triple2css(color);
  };

  editorInfo.ace_getRep = () => rep;

  editorInfo.ace_getAuthor = () => thisAuthor;

  const _nonScrollableEditEvents = {
    applyChangesToBase: 1,
  };

  for (const eventType of hooks.callAll('aceRegisterNonScrollableEditEvents')) {
    _nonScrollableEditEvents[eventType] = 1;
  }

  const isScrollableEditEvent = (eventType) => !_nonScrollableEditEvents[eventType];

  let currentCallStack = null;

  const inCallStack = (type, action) => {
    if (disposed) return;

    const newEditEvent = (eventType) => ({
      eventType,
      backset: null,
    });

    const submitOldEvent = (evt) => {
      if (rep.selStart && rep.selEnd) {
        const selStartChar = rep.lines.offsetOfIndex(rep.selStart[0]) + rep.selStart[1];
        const selEndChar = rep.lines.offsetOfIndex(rep.selEnd[0]) + rep.selEnd[1];
        evt.selStart = selStartChar;
        evt.selEnd = selEndChar;
        evt.selFocusAtStart = rep.selFocusAtStart;
      }
      if (undoModule.enabled) {
        let undoWorked = false;
        try {
          if (isPadLoading(evt.eventType)) {
            undoModule.clearHistory();
          } else if (evt.eventType === 'nonundoable') {
            if (evt.changeset) {
              undoModule.reportExternalChange(evt.changeset);
            }
          } else {
            undoModule.reportEvent(evt);
          }
          undoWorked = true;
        } finally {
          if (!undoWorked) {
            undoModule.enabled = false; // for safety
          }
        }
      }
    };

    const startNewEvent = (eventType, dontSubmitOld) => {
      const oldEvent = currentCallStack.editEvent;
      if (!dontSubmitOld) {
        submitOldEvent(oldEvent);
      }
      currentCallStack.editEvent = newEditEvent(eventType);
      return oldEvent;
    };

    currentCallStack = {
      type,
      docTextChanged: false,
      selectionAffected: false,
      userChangedSelection: false,
      domClean: false,
      isUserChange: false,
      // is this a "user change" type of call-stack
      repChanged: false,
      editEvent: newEditEvent(type),
      startNewEvent,
    };
    let cleanExit = false;
    let result;
    try {
      result = action();

      hooks.callAll('aceEditEvent', {
        callstack: currentCallStack,
        editorInfo,
        rep,
        documentAttributeManager,
      });

      cleanExit = true;
    } finally {
      const cs = currentCallStack;
      if (cleanExit) {
        submitOldEvent(cs.editEvent);
        if (cs.domClean && cs.type !== 'setup') {
          if (cs.selectionAffected) {
            updateBrowserSelectionFromRep();
          }
          if ((cs.docTextChanged || cs.userChangedSelection) && isScrollableEditEvent(cs.type)) {
            scrollSelectionIntoView();
          }
          if (cs.docTextChanged && cs.type.indexOf('importText') < 0) {
            outsideNotifyDirty();
          }
        }
      } else if (currentCallStack.type === 'idleWorkTimer') {
        idleWorkTimer.atLeast(1000);
      }
      currentCallStack = null;
    }
    return result;
  };
  editorInfo.ace_inCallStack = inCallStack;

  const inCallStackIfNecessary = (type, action) => {
    if (!currentCallStack) {
      inCallStack(type, action);
    } else {
      action();
    }
  };
  editorInfo.ace_inCallStackIfNecessary = inCallStackIfNecessary;

  const dispose = () => {
    disposed = true;
    if (idleWorkTimer) idleWorkTimer.never();
    teardown();
  };

  const setWraps = (newVal) => {
    doesWrap = newVal;
    targetBody.classList.toggle('doesWrap', doesWrap);
    scheduler.setTimeout(() => {
      inCallStackIfNecessary('setWraps', () => {
        fastIncorp(7);
        recreateDOM();
        fixView();
      });
    }, 0);
  };

  const setStyled = (newVal) => {
    const oldVal = isStyled;
    isStyled = !!newVal;

    if (newVal !== oldVal) {
      if (!newVal) {
        // clear styles
        inCallStackIfNecessary('setStyled', () => {
          fastIncorp(12);
          const clearStyles = [];
          for (const k of Object.keys(STYLE_ATTRIBS)) {
            clearStyles.push([k, '']);
          }
          performDocumentApplyAttributesToCharRange(0, rep.alltext.length, clearStyles);
        });
      }
    }
  };

  const setTextFace = (face) => {
    targetBody.style.fontFamily = face;
    lineMetricsDiv.style.fontFamily = face;
  };

  const recreateDOM = () => {
    // precond: normalized
    recolorLinesInRange(0, rep.alltext.length);
  };

  const setEditable = (newVal) => {
    isEditable = newVal;
    targetBody.contentEditable = isEditable ? 'true' : 'false';
    targetBody.classList.toggle('static', !isEditable);
  };

  const enforceEditability = () => setEditable(isEditable);

  const importText = (text, undoable, dontProcess) => {
    let lines;
    if (dontProcess) {
      if (text.charAt(text.length - 1) !== '\n') {
        throw new Error('new raw text must end with newline');
      }
      if (/[\r\t\xa0]/.exec(text)) {
        throw new Error('new raw text must not contain CR, tab, or nbsp');
      }
      lines = text.substring(0, text.length - 1).split('\n');
    } else {
      lines = text.split('\n').map(textify);
    }
    let newText = '\n';
    if (lines.length > 0) {
      newText = `${lines.join('\n')}\n`;
    }


    inCallStackIfNecessary(`importText${undoable ? 'Undoable' : ''}`, () => {
      setDocText(newText);
    });

    if (dontProcess && rep.alltext !== text) {
      throw new Error('mismatch error setting raw text in importText');
    }
  };

  const importAText = (atext, apoolJsonObj, undoable) => {
    atext = cloneAText(atext);
    if (apoolJsonObj) {
      const wireApool = (new AttribPool()).fromJsonable(apoolJsonObj);
      atext.attribs = moveOpsToNewPool(atext.attribs, wireApool, rep.apool);
    }
    inCallStackIfNecessary(`importText${undoable ? 'Undoable' : ''}`, () => {
      setDocAText(atext);
    });
  };

  const setDocAText = (atext) => {
    if (atext.text === '') {
      /*
       * The server is fine with atext.text being an empty string, but the front
       * end is not, and crashes.
       *
       * It is not clear if this is a problem in the server or in the client
       * code, and this is a client-side hack fix. The underlying problem needs
       * to be investigated.
       *
       * See for reference:
       * - https://github.com/ether/etherpad-lite/issues/3861
       */
      atext.text = '\n';
    }

    fastIncorp(8);

    const oldLen = rep.lines.totalWidth();
    const numLines = rep.lines.length();
    const upToLastLine = rep.lines.offsetOfIndex(numLines - 1);
    const lastLineLength = rep.lines.atIndex(numLines - 1).text.length;
    const assem = new SmartOpAssembler();
    const o = new Op('-');
    o.chars = upToLastLine;
    o.lines = numLines - 1;
    assem.append(o);
    o.chars = lastLineLength;
    o.lines = 0;
    assem.append(o);
    for (const op of opsFromAText(atext)) assem.append(op);
    const newLen = oldLen + assem.getLengthChange();
    const changeset = checkRep(
        pack(oldLen, newLen, assem.toString(), atext.text.slice(0, -1)));
    performDocumentApplyChangeset(changeset);

    performSelectionChange(
        [0, rep.lines.atIndex(0).lineMarker], [0, rep.lines.atIndex(0).lineMarker]);

    idleWorkTimer.atMost(100);

    if (rep.alltext !== atext.text) {
      throw new Error('mismatch error setting raw text in setDocAText');
    }
  };

  const setDocText = (text) => {
    setDocAText(makeAText(text));
  };

  const getDocText = () => {
    const alltext = rep.alltext;
    let len = alltext.length;
    if (len > 0) len--; // final extra newline
    return alltext.substring(0, len);
  };

  const exportText = () => {
    if (currentCallStack && !currentCallStack.domClean) {
      inCallStackIfNecessary('exportText', () => {
        fastIncorp(2);
      });
    }
    return getDocText();
  };

  const editorChangedSize = () => fixView();

  const setOnKeyPress = (handler) => {
    outsideKeyPress = handler;
  };

  const setOnKeyDown = (handler) => {
    outsideKeyDown = handler;
  };

  const setNotifyDirty = (handler) => {
    outsideNotifyDirty = handler;
  };

  const CMDS = {
    clearauthorship: (prompt) => {
      if ((!(rep.selStart && rep.selEnd)) || isCaret()) {
        if (prompt) {
          prompt();
        } else {
          performDocumentApplyAttributesToCharRange(0, rep.alltext.length, [
            ['author', ''],
          ]);
        }
      } else {
        setAttributeOnSelection('author', '');
      }
    },
  };

  const execCommand = (cmd, ...args) => {
    cmd = cmd.toLowerCase();
    if (CMDS[cmd]) {
      inCallStackIfNecessary(cmd, () => {
        fastIncorp(9);
        CMDS[cmd](...args);
      });
    }
  };

  const replaceRange = (start, end, text) => {
    inCallStackIfNecessary('replaceRange', () => {
      fastIncorp(9);
      performDocumentReplaceRange(start, end, text);
    });
  };

  editorInfo.ace_callWithAce = (fn, callStack, normalize) => {
    let wrapper = () => fn(editorInfo);

    if (normalize !== undefined) {
      const wrapper1 = wrapper;
      wrapper = () => {
        editorInfo.ace_fastIncorp(9);
        wrapper1();
      };
    }

    if (callStack !== undefined) {
      return editorInfo.ace_inCallStack(callStack, wrapper);
    } else {
      return wrapper();
    }
  };

  /**
   * This methed exposes a setter for some ace properties
   * @param key the name of the parameter
   * @param value the value to set to
   */
  editorInfo.ace_setProperty = (key, value) => {
    // These properties are exposed
    const setters = {
      wraps: setWraps,
      showsauthorcolors: (val) => targetBody.classList.toggle('authorColors', !!val),
      showsuserselections: (val) => targetBody.classList.toggle('userSelections', !!val),
      showslinenumbers: (value) => {
        hasLineNumbers = !!value;
        sideDiv.parentNode.classList.toggle('line-numbers-hidden', !hasLineNumbers);
        fixView();
      },
      userauthor: (value) => {
        thisAuthor = String(value);
        documentAttributeManager.author = thisAuthor;
      },
      styled: setStyled,
      textface: setTextFace,
      rtlistrue: (value) => {
        targetBody.classList.toggle('rtl', value);
        targetBody.classList.toggle('ltr', !value);
        document.documentElement.dir = value ? 'rtl' : 'ltr';
      },
    };

    const setter = setters[key.toLowerCase()];

    // check if setter is present
    if (setter !== undefined) {
      setter(value);
    }
  };

  editorInfo.ace_setBaseText = (txt) => {
    changesetTracker.setBaseText(txt);
  };
  editorInfo.ace_setBaseAttributedText = (atxt, apoolJsonObj) => {
    changesetTracker.setBaseAttributedText(atxt, apoolJsonObj);
  };
  editorInfo.ace_applyChangesToBase = (c, optAuthor, apoolJsonObj) => {
    changesetTracker.applyChangesToBase(c, optAuthor, apoolJsonObj);
  };
  editorInfo.ace_prepareUserChangeset = () => changesetTracker.prepareUserChangeset();
  editorInfo.ace_applyPreparedChangesetToBase = () => {
    changesetTracker.applyPreparedChangesetToBase();
  };
  editorInfo.ace_setUserChangeNotificationCallback = (f) => {
    changesetTracker.setUserChangeNotificationCallback(f);
  };
  editorInfo.ace_setAuthorInfo = (author, info) => {
    setAuthorInfo(author, info);
  };

  editorInfo.ace_getDocument = () => document;

  const now = () => Date.now();

  const newTimeLimit = (ms) => {
    const startTime = now();
    let exceededAlready = false;
    let printedTrace = false;
    const isTimeUp = () => {
      if (exceededAlready) {
        if ((!printedTrace)) {
          printedTrace = true;
        }
        return true;
      }
      const elapsed = now() - startTime;
      if (elapsed > ms) {
        exceededAlready = true;
        return true;
      } else {
        return false;
      }
    };

    isTimeUp.elapsed = () => now() - startTime;
    return isTimeUp;
  };


  const makeIdleAction = (func) => {
    let scheduledTimeout = null;
    let scheduledTime = 0;

    const unschedule = () => {
      if (scheduledTimeout) {
        scheduler.clearTimeout(scheduledTimeout);
        scheduledTimeout = null;
      }
    };

    const reschedule = (time) => {
      unschedule();
      scheduledTime = time;
      let delay = time - now();
      if (delay < 0) delay = 0;
      scheduledTimeout = scheduler.setTimeout(callback, delay);
    };

    const callback = () => {
      scheduledTimeout = null;
      // func may reschedule the action
      func();
    };

    return {
      atMost: (ms) => {
        const latestTime = now() + ms;
        if ((!scheduledTimeout) || scheduledTime > latestTime) {
          reschedule(latestTime);
        }
      },
      // atLeast(ms) will schedule the action if not scheduled yet.
      // In other words, "infinity" is replaced by ms, even though
      // it is technically larger.
      atLeast: (ms) => {
        const earliestTime = now() + ms;
        if ((!scheduledTimeout) || scheduledTime < earliestTime) {
          reschedule(earliestTime);
        }
      },
      never: () => {
        unschedule();
      },
    };
  };

  const fastIncorp = (n) => {
    // normalize but don't do any lexing or anything
    incorporateUserChanges();
  };
  editorInfo.ace_fastIncorp = fastIncorp;

  const idleWorkTimer = makeIdleAction(() => {
    if (inInternationalComposition) {
      // don't do idle input incorporation during international input composition
      idleWorkTimer.atLeast(500);
      return;
    }

    inCallStackIfNecessary('idleWorkTimer', () => {
      const isTimeUp = newTimeLimit(250);

      let finishedImportantWork = false;
      let finishedWork = false;

      try {
        incorporateUserChanges();

        if (isTimeUp()) return;

        updateLineNumbers(); // update line numbers if any time left
        if (isTimeUp()) return;
        finishedImportantWork = true;
        finishedWork = true;
      } finally {
        if (finishedWork) {
          idleWorkTimer.atMost(1000);
        } else if (finishedImportantWork) {
          // if we've finished highlighting the view area,
          // more highlighting could be counter-productive,
          // e.g. if the user just opened a triple-quote and will soon close it.
          idleWorkTimer.atMost(500);
        } else {
          let timeToWait = Math.round(isTimeUp.elapsed() / 2);
          if (timeToWait < 100) timeToWait = 100;
          idleWorkTimer.atMost(timeToWait);
        }
      }
    });
  });

  let _nextId = 1;

  const uniqueId = (n) => {
    // not actually guaranteed to be unique, e.g. if user copy-pastes
    // nodes with ids
    const nid = n.id;
    if (nid) return nid;
    return (n.id = `magicdomid${_nextId++}`);
  };


  const recolorLinesInRange = (startChar, endChar) => {
    if (endChar <= startChar) return;
    if (startChar < 0 || startChar >= rep.lines.totalWidth()) return;
    let lineEntry = rep.lines.atOffset(startChar); // rounds down to line boundary
    let lineStart = rep.lines.offsetOfEntry(lineEntry);
    let lineIndex = rep.lines.indexOfEntry(lineEntry);
    let selectionNeedsResetting = false;
    let firstLine = null;

    // tokenFunc function; accesses current value of lineEntry and curDocChar,
    // also mutates curDocChar
    const tokenFunc = (tokenText, tokenClass) => {
      lineEntry.domInfo.appendSpan(tokenText, tokenClass);
    };

    while (lineEntry && lineStart < endChar) {
      const lineEnd = lineStart + lineEntry.width;
      lineEntry.domInfo.clearSpans();
      getSpansForLine(lineEntry, tokenFunc, lineStart);
      lineEntry.domInfo.finishUpdate();

      markNodeClean(lineEntry.lineNode);

      if (rep.selStart && rep.selStart[0] === lineIndex ||
          rep.selEnd && rep.selEnd[0] === lineIndex) {
        selectionNeedsResetting = true;
      }

      if (firstLine == null) firstLine = lineIndex;
      lineStart = lineEnd;
      lineEntry = rep.lines.next(lineEntry);
      lineIndex++;
    }
    if (selectionNeedsResetting) {
      currentCallStack.selectionAffected = true;
    }
  };

  // like getSpansForRange, but for a line, and the func takes (text,class)
  // instead of (width,class); excludes the trailing '\n' from
  // consideration by func


  const getSpansForLine = (lineEntry, textAndClassFunc, lineEntryOffsetHint) => {
    let lineEntryOffset = lineEntryOffsetHint;
    if ((typeof lineEntryOffset) !== 'number') {
      lineEntryOffset = rep.lines.offsetOfEntry(lineEntry);
    }
    const text = lineEntry.text;
    if (text.length === 0) {
      // allow getLineStyleFilter to set line-div styles
      const func = linestylefilter.getLineStyleFilter(
          0, '', textAndClassFunc, rep.apool);
      func('', '');
    } else {
      let filteredFunc = linestylefilter.getFilterStack(text, textAndClassFunc, browser);
      const lineNum = rep.lines.indexOfEntry(lineEntry);
      const aline = rep.alines[lineNum];
      filteredFunc = linestylefilter.getLineStyleFilter(
          text.length, aline, filteredFunc, rep.apool);
      filteredFunc(text, '');
    }
  };

  let observedChanges;

  const clearObservedChanges = () => {
    observedChanges = {
      cleanNodesNearChanges: {},
    };
  };
  clearObservedChanges();

  const getCleanNodeByKey = (key) => {
    let n = targetDoc.getElementById(key);
    // copying and pasting can lead to duplicate ids
    while (n && isNodeDirty(n)) {
      n.id = '';
      n = targetDoc.getElementById(key);
    }
    return n;
  };

  const observeChangesAroundNode = (node) => {
    // Around this top-level DOM node, look for changes to the document
    // (from how it looks in our representation) and record them in a way
    // that can be used to "normalize" the document (apply the changes to our
    // representation, and put the DOM in a canonical form).
    let cleanNode;
    let hasAdjacentDirtyness;
    if (!isNodeDirty(node)) {
      cleanNode = node;
      const prevSib = cleanNode.previousSibling;
      const nextSib = cleanNode.nextSibling;
      hasAdjacentDirtyness = ((prevSib && isNodeDirty(prevSib)) ||
         (nextSib && isNodeDirty(nextSib)));
    } else {
      // node is dirty, look for clean node above
      let upNode = node.previousSibling;
      while (upNode && isNodeDirty(upNode)) {
        upNode = upNode.previousSibling;
      }
      if (upNode) {
        cleanNode = upNode;
      } else {
        let downNode = node.nextSibling;
        while (downNode && isNodeDirty(downNode)) {
          downNode = downNode.nextSibling;
        }
        if (downNode) {
          cleanNode = downNode;
        }
      }
      if (!cleanNode) {
        // Couldn't find any adjacent clean nodes!
        // Since top and bottom of doc is dirty, the dirty area will be detected.
        return;
      }
      hasAdjacentDirtyness = true;
    }

    if (hasAdjacentDirtyness) {
      // previous or next line is dirty
      observedChanges.cleanNodesNearChanges[`$${uniqueId(cleanNode)}`] = true;
    } else {
      // next and prev lines are clean (if they exist)
      const lineKey = uniqueId(cleanNode);
      const prevSib = cleanNode.previousSibling;
      const nextSib = cleanNode.nextSibling;
      const actualPrevKey = ((prevSib && uniqueId(prevSib)) || null);
      const actualNextKey = ((nextSib && uniqueId(nextSib)) || null);
      const repPrevEntry = rep.lines.prev(rep.lines.atKey(lineKey));
      const repNextEntry = rep.lines.next(rep.lines.atKey(lineKey));
      const repPrevKey = ((repPrevEntry && repPrevEntry.key) || null);
      const repNextKey = ((repNextEntry && repNextEntry.key) || null);
      if (actualPrevKey !== repPrevKey || actualNextKey !== repNextKey) {
        observedChanges.cleanNodesNearChanges[`$${uniqueId(cleanNode)}`] = true;
      }
    }
  };

  const observeChangesAroundSelection = () => {
    if (currentCallStack.observedSelection) return;
    currentCallStack.observedSelection = true;

    const selection = getSelection();

    if (selection) {
      const node1 = topLevel(selection.startPoint.node);
      const node2 = topLevel(selection.endPoint.node);
      if (node1) observeChangesAroundNode(node1);
      if (node2 && node1 !== node2) {
        observeChangesAroundNode(node2);
      }
    }
  };

  const observeSuspiciousNodes = () => {
    // inspired by Firefox bug #473255, where pasting formatted text
    // causes the cursor to jump away, making the new HTML never found.
    if (targetBody.getElementsByTagName) {
      const elts = targetBody.getElementsByTagName('style');
      for (const elt of elts) {
        const n = topLevel(elt);
        if (n && n.parentNode === targetBody) {
          observeChangesAroundNode(n);
        }
      }
    }
  };

  const incorporateUserChanges = () => {
    if (currentCallStack.domClean) return false;

    currentCallStack.isUserChange = true;

    if (DEBUG && window.DONT_INCORP || window.DEBUG_DONT_INCORP) return false;

    // returns true if dom changes were made
    if (!targetBody.firstChild) {
      targetBody.innerHTML = '<div><!-- --></div>';
    }

    observeChangesAroundSelection();
    observeSuspiciousNodes();
    let dirtyRanges = getDirtyRanges();
    let dirtyRangesCheckOut = true;
    let j = 0;
    let a, b;
    let scrollToTheLeftNeeded = false;

    while (j < dirtyRanges.length) {
      a = dirtyRanges[j][0];
      b = dirtyRanges[j][1];
      if (!((a === 0 || getCleanNodeByKey(rep.lines.atIndex(a - 1).key)) &&
          (b === rep.lines.length() || getCleanNodeByKey(rep.lines.atIndex(b).key)))) {
        dirtyRangesCheckOut = false;
        break;
      }
      j++;
    }
    if (!dirtyRangesCheckOut) {
      for (const bodyNode of targetBody.childNodes) {
        if ((bodyNode.tagName) && ((!bodyNode.id) || (!rep.lines.containsKey(bodyNode.id)))) {
          observeChangesAroundNode(bodyNode);
        }
      }
      dirtyRanges = getDirtyRanges();
    }

    clearObservedChanges();

    const selection = getSelection();

    let selStart, selEnd; // each one, if truthy, has [line,char] needed to set selection
    let i = 0;
    const splicesToDo = [];
    let netNumLinesChangeSoFar = 0;
    const toDeleteAtEnd = [];
    const domInsertsNeeded = []; // each entry is [nodeToInsertAfter, [info1, info2, ...]]
    while (i < dirtyRanges.length) {
      const range = dirtyRanges[i];
      a = range[0];
      b = range[1];
      let firstDirtyNode = (((a === 0) && targetBody.firstChild) ||
          getCleanNodeByKey(rep.lines.atIndex(a - 1).key).nextSibling);
      firstDirtyNode = (firstDirtyNode && isNodeDirty(firstDirtyNode) && firstDirtyNode);

      let lastDirtyNode = (((b === rep.lines.length()) && targetBody.lastChild) ||
          getCleanNodeByKey(rep.lines.atIndex(b).key).previousSibling);

      lastDirtyNode = (lastDirtyNode && isNodeDirty(lastDirtyNode) && lastDirtyNode);
      if (firstDirtyNode && lastDirtyNode) {
        const cc = makeContentCollector(isStyled, browser, rep.apool, className2Author);
        cc.notifySelection(selection);
        const dirtyNodes = [];
        for (let n = firstDirtyNode; n &&
            !(n.previousSibling && n.previousSibling === lastDirtyNode);
          n = n.nextSibling) {
          cc.collectContent(n);
          dirtyNodes.push(n);
        }
        cc.notifyNextNode(lastDirtyNode.nextSibling);
        let lines = cc.getLines();
        if ((lines.length <= 1 || lines[lines.length - 1] !== '') && lastDirtyNode.nextSibling) {
          // dirty region doesn't currently end a line, even taking the following node
          // (or lack of node) into account, so include the following clean node.
          // It could be SPAN or a DIV; basically this is any case where the contentCollector
          // decides it isn't done.
          // Note that this clean node might need to be there for the next dirty range.
          b++;
          const cleanLine = lastDirtyNode.nextSibling;
          cc.collectContent(cleanLine);
          toDeleteAtEnd.push(cleanLine);
          cc.notifyNextNode(cleanLine.nextSibling);
        }

        const ccData = cc.finish();
        const ss = ccData.selStart;
        const se = ccData.selEnd;
        lines = ccData.lines;
        const lineAttribs = ccData.lineAttribs;
        const linesWrapped = ccData.linesWrapped;

        if (linesWrapped > 0) {
          // Chrome decides in its infinite wisdom that it's okay to put the browser's visisble
          // window in the middle of the span. An outcome of this is that the first chars of the
          // string are no longer visible to the user.. Yay chrome.. Move the browser's visible area
          // to the left hand side of the span. Firefox isn't quite so bad, but it's still pretty
          // quirky.
          scrollToTheLeftNeeded = true;
        }

        if (ss[0] >= 0) selStart = [ss[0] + a + netNumLinesChangeSoFar, ss[1]];
        if (se[0] >= 0) selEnd = [se[0] + a + netNumLinesChangeSoFar, se[1]];

        const entries = [];
        const nodeToAddAfter = lastDirtyNode;
        const lineNodeInfos = [];
        for (const lineString of lines) {
          const newEntry = createDomLineEntry(lineString);
          entries.push(newEntry);
          lineNodeInfos.push(newEntry.domInfo);
        }
        domInsertsNeeded.push([nodeToAddAfter, lineNodeInfos]);
        for (const n of dirtyNodes) toDeleteAtEnd.push(n);
        const spliceHints = {};
        if (selStart) spliceHints.selStart = selStart;
        if (selEnd) spliceHints.selEnd = selEnd;
        splicesToDo.push([a + netNumLinesChangeSoFar, b - a, entries, lineAttribs, spliceHints]);
        netNumLinesChangeSoFar += (lines.length - (b - a));
      } else if (b > a) {
        splicesToDo.push([a + netNumLinesChangeSoFar, b - a, [], []]);
      }
      i++;
    }

    const domChanges = (splicesToDo.length > 0);

    for (const splice of splicesToDo) doIncorpLineSplice(...splice);
    for (const ins of domInsertsNeeded) insertDomLines(...ins);
    for (const n of toDeleteAtEnd) n.remove();

    // needed to stop chrome from breaking the ui when long strings without spaces are pasted
    if (scrollToTheLeftNeeded) {
      $('#innerdocbody').scrollLeft(0);
    }

    // if the nodes that define the selection weren't encountered during
    // content collection, figure out where those nodes are now.
    if (selection && !selStart) {
      const selStartFromHook = hooks.callAll('aceStartLineAndCharForPoint', {
        callstack: currentCallStack,
        editorInfo,
        rep,
        root: targetBody,
        point: selection.startPoint,
        documentAttributeManager,
      });
      selStart = (selStartFromHook == null || selStartFromHook.length === 0)
        ? getLineAndCharForPoint(selection.startPoint) : selStartFromHook;
    }
    if (selection && !selEnd) {
      const selEndFromHook = hooks.callAll('aceEndLineAndCharForPoint', {
        callstack: currentCallStack,
        editorInfo,
        rep,
        root: targetBody,
        point: selection.endPoint,
        documentAttributeManager,
      });
      selEnd = (selEndFromHook == null ||
         selEndFromHook.length === 0)
        ? getLineAndCharForPoint(selection.endPoint) : selEndFromHook;
    }

    // selection from content collection can, in various ways, extend past final
    // BR in firefox DOM, so cap the line
    const numLines = rep.lines.length();
    if (selStart && selStart[0] >= numLines) {
      selStart[0] = numLines - 1;
      selStart[1] = rep.lines.atIndex(selStart[0]).text.length;
    }
    if (selEnd && selEnd[0] >= numLines) {
      selEnd[0] = numLines - 1;
      selEnd[1] = rep.lines.atIndex(selEnd[0]).text.length;
    }

    // update rep if we have a new selection
    // NOTE: IE loses the selection when you click stuff in e.g. the
    // editbar, so removing the selection when it's lost is not a good
    // idea.
    if (selection) repSelectionChange(selStart, selEnd, selection && selection.focusAtStart);
    // update browser selection
    if (selection && (domChanges || isCaret())) {
      // if no DOM changes (not this case), want to treat range selection delicately,
      // e.g. in IE not lose which end of the selection is the focus/anchor;
      // on the other hand, we may have just noticed a press of PageUp/PageDown
      currentCallStack.selectionAffected = true;
    }

    currentCallStack.domClean = true;

    fixView();

    return domChanges;
  };

  const STYLE_ATTRIBS = {
    bold: true,
    italic: true,
    underline: true,
    strikethrough: true,
    list: true,
  };

  const isStyleAttribute = (aname) => !!STYLE_ATTRIBS[aname];

  const isDefaultLineAttribute =
      (aname) => AttributeManager.DEFAULT_LINE_ATTRIBUTES.indexOf(aname) !== -1;

  const insertDomLines = (nodeToAddAfter, infoStructs) => {
    let lastEntry;
    let lineStartOffset;
    for (const info of infoStructs) {
      const node = info.node;
      const key = uniqueId(node);
      let entry;
      if (lastEntry) {
        // optimization to avoid recalculation
        const next = rep.lines.next(lastEntry);
        if (next && next.key === key) {
          entry = next;
          lineStartOffset += lastEntry.width;
        }
      }
      if (!entry) {
        entry = rep.lines.atKey(key);
        lineStartOffset = rep.lines.offsetOfKey(key);
      }
      lastEntry = entry;
      getSpansForLine(entry, (tokenText, tokenClass) => {
        info.appendSpan(tokenText, tokenClass);
      }, lineStartOffset);
      info.prepareForAdd();
      entry.lineMarker = info.lineMarker;
      if (!nodeToAddAfter) {
        targetBody.insertBefore(node, targetBody.firstChild);
      } else {
        targetBody.insertBefore(node, nodeToAddAfter.nextSibling);
      }
      nodeToAddAfter = node;
      info.notifyAdded();
      markNodeClean(node);
    }
  };

  const isCaret = () => (rep.selStart && rep.selEnd &&
                         rep.selStart[0] === rep.selEnd[0] && rep.selStart[1] === rep.selEnd[1]);
  editorInfo.ace_isCaret = isCaret;

  // prereq: isCaret()
  const caretLine = () => rep.selStart[0];

  editorInfo.ace_caretLine = caretLine;

  const caretColumn = () => rep.selStart[1];

  editorInfo.ace_caretColumn = caretColumn;

  const caretDocChar = () => rep.lines.offsetOfIndex(caretLine()) + caretColumn();

  editorInfo.ace_caretDocChar = caretDocChar;

  const handleReturnIndentation = () => {
    // on return, indent to level of previous line
    if (isCaret() && caretColumn() === 0 && caretLine() > 0) {
      const lineNum = caretLine();
      const thisLine = rep.lines.atIndex(lineNum);
      const prevLine = rep.lines.prev(thisLine);
      const prevLineText = prevLine.text;
      let theIndent = /^ *(?:)/.exec(prevLineText)[0];
      const shouldIndent = window.clientVars.indentationOnNewLine;
      if (shouldIndent && /[[(:{]\s*$/.exec(prevLineText)) {
        theIndent += THE_TAB;
      }
      const cs = new Builder(rep.lines.totalWidth()).keep(
          rep.lines.offsetOfIndex(lineNum), lineNum).insert(
          theIndent, [
            ['author', thisAuthor],
          ], rep.apool).toString();
      performDocumentApplyChangeset(cs);
      performSelectionChange([lineNum, theIndent.length], [lineNum, theIndent.length]);
    }
  };

  const getPointForLineAndChar = (lineAndChar) => {
    const line = lineAndChar[0];
    let charsLeft = lineAndChar[1];
    const lineEntry = rep.lines.atIndex(line);
    charsLeft -= lineEntry.lineMarker;
    if (charsLeft < 0) {
      charsLeft = 0;
    }
    const lineNode = lineEntry.lineNode;
    let n = lineNode;
    let after = false;
    if (charsLeft === 0) {
      return {
        node: lineNode,
        index: 0,
        maxIndex: 1,
      };
    }
    while (!(n === lineNode && after)) {
      if (after) {
        if (n.nextSibling) {
          n = n.nextSibling;
          after = false;
        } else { n = n.parentNode; }
      } else if (isNodeText(n)) {
        const len = n.nodeValue.length;
        if (charsLeft <= len) {
          return {
            node: n,
            index: charsLeft,
            maxIndex: len,
          };
        }
        charsLeft -= len;
        after = true;
      } else if (n.firstChild) { n = n.firstChild; } else { after = true; }
    }
    return {
      node: lineNode,
      index: 1,
      maxIndex: 1,
    };
  };

  const nodeText = (n) => n.textContent || n.nodeValue || '';

  const getLineAndCharForPoint = (point) => {
    // Turn DOM node selection into [line,char] selection.
    // This method has to work when the DOM is not pristine,
    // assuming the point is not in a dirty node.
    if (point.node === targetBody) {
      if (point.index === 0) {
        return [0, 0];
      } else {
        const N = rep.lines.length();
        const ln = rep.lines.atIndex(N - 1);
        return [N - 1, ln.text.length];
      }
    } else {
      let n = point.node;
      let col = 0;
      // if this part fails, it probably means the selection node
      // was dirty, and we didn't see it when collecting dirty nodes.
      if (isNodeText(n)) {
        col = point.index;
      } else if (point.index > 0) {
        col = nodeText(n).length;
      }
      let parNode, prevSib;
      while ((parNode = n.parentNode) !== targetBody) {
        if ((prevSib = n.previousSibling)) {
          n = prevSib;
          col += nodeText(n).length;
        } else {
          n = parNode;
        }
      }
      if (n.firstChild && isBlockElement(n.firstChild)) {
        col += 1; // lineMarker
      }
      const lineEntry = rep.lines.atKey(n.id);
      const lineNum = rep.lines.indexOfEntry(lineEntry);
      return [lineNum, col];
    }
  };
  editorInfo.ace_getLineAndCharForPoint = getLineAndCharForPoint;

  const createDomLineEntry = (lineString) => {
    const info = doCreateDomLine(lineString.length > 0);
    const newNode = info.node;
    return {
      key: uniqueId(newNode),
      text: lineString,
      lineNode: newNode,
      domInfo: info,
      lineMarker: 0,
    };
  };

  const performDocumentApplyChangeset = (changes, insertsAfterSelection) => {
    const domAndRepSplice = (startLine, deleteCount, newLineStrings) => {
      const keysToDelete = [];
      if (deleteCount > 0) {
        let entryToDelete = rep.lines.atIndex(startLine);
        for (let i = 0; i < deleteCount; i++) {
          keysToDelete.push(entryToDelete.key);
          entryToDelete = rep.lines.next(entryToDelete);
        }
      }

      const lineEntries = newLineStrings.map(createDomLineEntry);

      doRepLineSplice(startLine, deleteCount, lineEntries);

      let nodeToAddAfter;
      if (startLine > 0) {
        nodeToAddAfter = getCleanNodeByKey(rep.lines.atIndex(startLine - 1).key);
      } else { nodeToAddAfter = null; }

      insertDomLines(nodeToAddAfter, lineEntries.map((entry) => entry.domInfo));

      for (const k of keysToDelete) {
        const n = targetDoc.getElementById(k);
        n.parentNode.removeChild(n);
      }

      if (
        (rep.selStart &&
          rep.selStart[0] >= startLine &&
          rep.selStart[0] <= startLine + deleteCount) ||
         (rep.selEnd && rep.selEnd[0] >= startLine && rep.selEnd[0] <= startLine + deleteCount)) {
        currentCallStack.selectionAffected = true;
      }
    };

    doRepApplyChangeset(changes, insertsAfterSelection);

    let requiredSelectionSetting = null;
    if (rep.selStart && rep.selEnd) {
      const selStartChar = rep.lines.offsetOfIndex(rep.selStart[0]) + rep.selStart[1];
      const selEndChar = rep.lines.offsetOfIndex(rep.selEnd[0]) + rep.selEnd[1];
      const result =
          characterRangeFollow(changes, selStartChar, selEndChar, insertsAfterSelection);
      requiredSelectionSetting = [result[0], result[1], rep.selFocusAtStart];
    }

    const linesMutatee = {
      splice: (start, numRemoved, ...args) => {
        domAndRepSplice(start, numRemoved, args.map((s) => s.slice(0, -1)));
      },
      get: (i) => `${rep.lines.atIndex(i).text}\n`,
      length: () => rep.lines.length(),
    };

    mutateTextLines(changes, linesMutatee);

    if (requiredSelectionSetting) {
      performSelectionChange(
          lineAndColumnFromChar(requiredSelectionSetting[0]),
          lineAndColumnFromChar(requiredSelectionSetting[1]),
          requiredSelectionSetting[2]);
    }
  };

  const doRepApplyChangeset = (changes, insertsAfterSelection) => {
    checkRep(changes);

    if (oldLen(changes) !== rep.alltext.length) {
      const errMsg = `${oldLen(changes)}/${rep.alltext.length}`;
      throw new Error(`doRepApplyChangeset length mismatch: ${errMsg}`);
    }

    const editEvent = currentCallStack.editEvent;
    if (editEvent.eventType === 'nonundoable') {
      if (!editEvent.changeset) {
        editEvent.changeset = changes;
      } else {
        editEvent.changeset = compose(editEvent.changeset, changes, rep.apool);
      }
    } else {
      const inverseChangeset = inverse(changes, {
        get: (i) => `${rep.lines.atIndex(i).text}\n`,
        length: () => rep.lines.length(),
      }, rep.alines, rep.apool);

      if (!editEvent.backset) {
        editEvent.backset = inverseChangeset;
      } else {
        editEvent.backset = compose(inverseChangeset, editEvent.backset, rep.apool);
      }
    }

    mutateAttributionLines(changes, rep.alines, rep.apool);

    if (changesetTracker.isTracking()) {
      changesetTracker.composeUserChangeset(changes);
    }
  };

  /**
   * Converts the position of a char (index in String) into a [row, col] tuple
   */
  const lineAndColumnFromChar = (x) => {
    const lineEntry = rep.lines.atOffset(x);
    const lineStart = rep.lines.offsetOfEntry(lineEntry);
    const lineNum = rep.lines.indexOfEntry(lineEntry);
    return [lineNum, x - lineStart];
  };

  const performDocumentReplaceCharRange = (startChar, endChar, newText) => {
    if (startChar === endChar && newText.length === 0) {
      return;
    }
    // Requires that the replacement preserve the property that the
    // internal document text ends in a newline.  Given this, we
    // rewrite the splice so that it doesn't touch the very last
    // char of the document.
    if (endChar === rep.alltext.length) {
      if (startChar === endChar) {
        // an insert at end
        startChar--;
        endChar--;
        newText = `\n${newText.substring(0, newText.length - 1)}`;
      } else if (newText.length === 0) {
        // a delete at end
        startChar--;
        endChar--;
      } else {
        // a replace at end
        endChar--;
        newText = newText.substring(0, newText.length - 1);
      }
    }
    performDocumentReplaceRange(
        lineAndColumnFromChar(startChar), lineAndColumnFromChar(endChar), newText);
  };

  const performDocumentApplyAttributesToCharRange = (start, end, attribs) => {
    end = Math.min(end, rep.alltext.length - 1);
    documentAttributeManager.setAttributesOnRange(
        lineAndColumnFromChar(start), lineAndColumnFromChar(end), attribs);
  };

  editorInfo.ace_performDocumentApplyAttributesToCharRange =
      performDocumentApplyAttributesToCharRange;

  const setAttributeOnSelection = (attributeName, attributeValue) => {
    if (!(rep.selStart && rep.selEnd)) return;

    documentAttributeManager.setAttributesOnRange(rep.selStart, rep.selEnd, [
      [attributeName, attributeValue],
    ]);
  };
  editorInfo.ace_setAttributeOnSelection = setAttributeOnSelection;

  const getAttributeOnSelection = (attributeName, prevChar) => {
    if (!(rep.selStart && rep.selEnd)) return;
    const isNotSelection = (rep.selStart[0] === rep.selEnd[0] && rep.selEnd[1] === rep.selStart[1]);
    if (isNotSelection) {
      if (prevChar) {
        // If it's not the start of the line
        if (rep.selStart[1] !== 0) {
          rep.selStart[1]--;
        }
      }
    }

    const withIt = new AttributeMap(rep.apool).set(attributeName, 'true').toString();
    const withItRegex = new RegExp(`${withIt.replace(/\*/g, '\\*')}(\\*|$)`);
    const hasIt = (attribs) => withItRegex.test(attribs);

    const rangeHasAttrib = (selStart, selEnd) => {
      // if range is collapsed -> no attribs in range
      if (selStart[1] === selEnd[1] && selStart[0] === selEnd[0]) return false;

      if (selStart[0] !== selEnd[0]) { // -> More than one line selected
        let hasAttrib = true;

        // from selStart to the end of the first line
        hasAttrib = hasAttrib &&
            rangeHasAttrib(selStart, [selStart[0], rep.lines.atIndex(selStart[0]).text.length]);

        // for all lines in between
        for (let n = selStart[0] + 1; n < selEnd[0]; n++) {
          hasAttrib = hasAttrib && rangeHasAttrib([n, 0], [n, rep.lines.atIndex(n).text.length]);
        }

        // for the last, potentially partial, line
        hasAttrib = hasAttrib && rangeHasAttrib([selEnd[0], 0], [selEnd[0], selEnd[1]]);

        return hasAttrib;
      }

      // Logic tells us we now have a range on a single line

      const lineNum = selStart[0];
      const start = selStart[1];
      const end = selEnd[1];
      let hasAttrib = true;

      let indexIntoLine = 0;
      for (const op of deserializeOps(rep.alines[lineNum])) {
        const opStartInLine = indexIntoLine;
        const opEndInLine = opStartInLine + op.chars;
        if (!hasIt(op.attribs)) {
          // does op overlap selection?
          if (!(opEndInLine <= start || opStartInLine >= end)) {
            // since it's overlapping but hasn't got the attrib -> range hasn't got it
            hasAttrib = false;
            break;
          }
        }
        indexIntoLine = opEndInLine;
      }

      return hasAttrib;
    };
    return rangeHasAttrib(rep.selStart, rep.selEnd);
  };

  editorInfo.ace_getAttributeOnSelection = getAttributeOnSelection;

  const toggleAttributeOnSelection = (attributeName) => {
    if (!(rep.selStart && rep.selEnd)) return;

    let selectionAllHasIt = true;
    const withIt = new AttributeMap(rep.apool).set(attributeName, 'true').toString();
    const withItRegex = new RegExp(`${withIt.replace(/\*/g, '\\*')}(\\*|$)`);

    const hasIt = (attribs) => withItRegex.test(attribs);

    const selStartLine = rep.selStart[0];
    const selEndLine = rep.selEnd[0];
    for (let n = selStartLine; n <= selEndLine; n++) {
      let indexIntoLine = 0;
      let selectionStartInLine = 0;
      if (documentAttributeManager.lineHasMarker(n)) {
        selectionStartInLine = 1; // ignore "*" used as line marker
      }
      let selectionEndInLine = rep.lines.atIndex(n).text.length; // exclude newline
      if (n === selStartLine) {
        selectionStartInLine = rep.selStart[1];
      }
      if (n === selEndLine) {
        selectionEndInLine = rep.selEnd[1];
      }
      for (const op of deserializeOps(rep.alines[n])) {
        const opStartInLine = indexIntoLine;
        const opEndInLine = opStartInLine + op.chars;
        if (!hasIt(op.attribs)) {
          // does op overlap selection?
          if (!(opEndInLine <= selectionStartInLine || opStartInLine >= selectionEndInLine)) {
            selectionAllHasIt = false;
            break;
          }
        }
        indexIntoLine = opEndInLine;
      }
      if (!selectionAllHasIt) {
        break;
      }
    }


    const attributeValue = selectionAllHasIt ? '' : 'true';
    documentAttributeManager.setAttributesOnRange(
        rep.selStart, rep.selEnd, [[attributeName, attributeValue]]);
    if (attribIsFormattingStyle(attributeName)) {
      updateStyleButtonState(attributeName, !selectionAllHasIt); // italic, bold, ...
    }
  };
  editorInfo.ace_toggleAttributeOnSelection = toggleAttributeOnSelection;

  const performDocumentReplaceSelection = (newText) => {
    if (!(rep.selStart && rep.selEnd)) return;
    performDocumentReplaceRange(rep.selStart, rep.selEnd, newText);
  };

  // Change the abstract representation of the document to have a different set of lines.
  // Must be called after rep.alltext is set.
  const doRepLineSplice = (startLine, deleteCount, newLineEntries) => {
    for (const entry of newLineEntries) entry.width = entry.text.length + 1;

    const startOldChar = rep.lines.offsetOfIndex(startLine);
    const endOldChar = rep.lines.offsetOfIndex(startLine + deleteCount);

    rep.lines.splice(startLine, deleteCount, newLineEntries);
    currentCallStack.docTextChanged = true;
    currentCallStack.repChanged = true;
    const newText = newLineEntries.map((e) => `${e.text}\n`).join('');

    rep.alltext = rep.alltext.substring(0, startOldChar) +
       newText + rep.alltext.substring(endOldChar, rep.alltext.length);
  };

  const doIncorpLineSplice = (startLine, deleteCount, newLineEntries, lineAttribs, hints) => {
    const startOldChar = rep.lines.offsetOfIndex(startLine);
    const endOldChar = rep.lines.offsetOfIndex(startLine + deleteCount);

    const oldRegionStart = rep.lines.offsetOfIndex(startLine);

    let selStartHintChar, selEndHintChar;
    if (hints && hints.selStart) {
      selStartHintChar =
          rep.lines.offsetOfIndex(hints.selStart[0]) + hints.selStart[1] - oldRegionStart;
    }
    if (hints && hints.selEnd) {
      selEndHintChar = rep.lines.offsetOfIndex(hints.selEnd[0]) + hints.selEnd[1] - oldRegionStart;
    }

    const newText = newLineEntries.map((e) => `${e.text}\n`).join('');
    const oldText = rep.alltext.substring(startOldChar, endOldChar);
    const oldAttribs = rep.alines.slice(startLine, startLine + deleteCount).join('');
    const newAttribs = `${lineAttribs.join('|1+1')}|1+1`; // not valid in a changeset
    const analysis =
        analyzeChange(oldText, newText, oldAttribs, newAttribs, selStartHintChar, selEndHintChar);
    const commonStart = analysis[0];
    let commonEnd = analysis[1];
    let shortOldText = oldText.substring(commonStart, oldText.length - commonEnd);
    let shortNewText = newText.substring(commonStart, newText.length - commonEnd);
    let spliceStart = startOldChar + commonStart;
    let spliceEnd = endOldChar - commonEnd;
    let shiftFinalNewlineToBeforeNewText = false;

    // adjust the splice to not involve the final newline of the document;
    // be very defensive
    if (shortOldText.charAt(shortOldText.length - 1) === '\n' &&
        shortNewText.charAt(shortNewText.length - 1) === '\n') {
      // replacing text that ends in newline with text that also ends in newline
      // (still, after analysis, somehow)
      shortOldText = shortOldText.slice(0, -1);
      shortNewText = shortNewText.slice(0, -1);
      spliceEnd--;
      commonEnd++;
    }
    if (shortOldText.length === 0 &&
        spliceStart === rep.alltext.length &&
        shortNewText.length > 0) {
      // inserting after final newline, bad
      spliceStart--;
      spliceEnd--;
      shortNewText = `\n${shortNewText.slice(0, -1)}`;
      shiftFinalNewlineToBeforeNewText = true;
    }
    if (spliceEnd === rep.alltext.length &&
      shortOldText.length > 0 &&
      shortNewText.length === 0) {
      // deletion at end of rep.alltext
      if (rep.alltext.charAt(spliceStart - 1) === '\n') {
        // (if not then what the heck?  it will definitely lead
        // to a rep.alltext without a final newline)
        spliceStart--;
        spliceEnd--;
      }
    }

    if (!(shortOldText.length === 0 && shortNewText.length === 0)) {
      const oldDocText = rep.alltext;
      const oldLen = oldDocText.length;

      const spliceStartLine = rep.lines.indexOfOffset(spliceStart);
      const spliceStartLineStart = rep.lines.offsetOfIndex(spliceStartLine);

      const startBuilder = () => {
        const builder = new Builder(oldLen);
        builder.keep(spliceStartLineStart, spliceStartLine);
        builder.keep(spliceStart - spliceStartLineStart);
        return builder;
      };

      const eachAttribRun = (attribs, func /* (startInNewText, endInNewText, attribs)*/) => {
        let textIndex = 0;
        const newTextStart = commonStart;
        const newTextEnd = newText.length - commonEnd - (shiftFinalNewlineToBeforeNewText ? 1 : 0);
        for (const op of deserializeOps(attribs)) {
          const nextIndex = textIndex + op.chars;
          if (!(nextIndex <= newTextStart || textIndex >= newTextEnd)) {
            func(Math.max(newTextStart, textIndex), Math.min(newTextEnd, nextIndex), op.attribs);
          }
          textIndex = nextIndex;
        }
      };

      const justApplyStyles = (shortNewText === shortOldText);
      let theChangeset;

      if (justApplyStyles) {
        // create changeset that clears the incorporated styles on
        // the existing text.  we compose this with the
        // changeset the applies the styles found in the DOM.
        // This allows us to incorporate, e.g., Safari's native "unbold".
        const incorpedAttribClearer = cachedStrFunc(
            (oldAtts) => mapAttribNumbers(oldAtts, (n) => {
              const k = rep.apool.getAttribKey(n);
              if (isStyleAttribute(k)) {
                return rep.apool.putAttrib([k, '']);
              }
              return false;
            }));

        const builder1 = startBuilder();
        if (shiftFinalNewlineToBeforeNewText) {
          builder1.keep(1, 1);
        }
        eachAttribRun(oldAttribs, (start, end, attribs) => {
          builder1.keepText(newText.substring(start, end), incorpedAttribClearer(attribs));
        });
        const clearer = builder1.toString();

        const builder2 = startBuilder();
        if (shiftFinalNewlineToBeforeNewText) {
          builder2.keep(1, 1);
        }
        eachAttribRun(newAttribs, (start, end, attribs) => {
          builder2.keepText(newText.substring(start, end), attribs);
        });
        const styler = builder2.toString();

        theChangeset = compose(clearer, styler, rep.apool);
      } else {
        const builder = startBuilder();

        const spliceEndLine = rep.lines.indexOfOffset(spliceEnd);
        const spliceEndLineStart = rep.lines.offsetOfIndex(spliceEndLine);
        if (spliceEndLineStart > spliceStart) {
          builder.remove(spliceEndLineStart - spliceStart, spliceEndLine - spliceStartLine);
          builder.remove(spliceEnd - spliceEndLineStart);
        } else {
          builder.remove(spliceEnd - spliceStart);
        }

        let isNewTextMultiauthor = false;
        const authorizer = cachedStrFunc((oldAtts) => {
          const attribs = AttributeMap.fromString(oldAtts, rep.apool);
          if (!isNewTextMultiauthor || !attribs.has('author')) attribs.set('author', thisAuthor);
          return attribs.toString();
        });

        let foundDomAuthor = '';
        eachAttribRun(newAttribs, (start, end, attribs) => {
          const a = AttributeMap.fromString(attribs, rep.apool).get('author');
          if (a && a !== foundDomAuthor) {
            if (!foundDomAuthor) {
              foundDomAuthor = a;
            } else {
              isNewTextMultiauthor = true; // multiple authors in DOM!
            }
          }
        });

        if (shiftFinalNewlineToBeforeNewText) {
          builder.insert('\n', authorizer(''));
        }

        eachAttribRun(newAttribs, (start, end, attribs) => {
          builder.insert(newText.substring(start, end), authorizer(attribs));
        });
        theChangeset = builder.toString();
      }

      doRepApplyChangeset(theChangeset);
    }

    // do this no matter what, because we need to get the right
    // line keys into the rep.
    doRepLineSplice(startLine, deleteCount, newLineEntries);
  };

  const cachedStrFunc = (func) => {
    const cache = {};
    return (s) => {
      if (!cache[s]) {
        cache[s] = func(s);
      }
      return cache[s];
    };
  };

  const analyzeChange = (
    oldText, newText, oldAttribs, newAttribs, optSelStartHint, optSelEndHint) => {
    // we need to take into account both the styles attributes & attributes defined by
    // the plugins, so basically we can ignore only the default line attribs used by
    // Etherpad
    const incorpedAttribFilter = (anum) => !isDefaultLineAttribute(rep.apool.getAttribKey(anum));

    const attribRuns = (attribs) => {
      const lengs = [];
      const atts = [];
      for (const op of deserializeOps(attribs)) {
        lengs.push(op.chars);
        atts.push(op.attribs);
      }
      return [lengs, atts];
    };

    const attribIterator = (runs, backward) => {
      const lengs = runs[0];
      const atts = runs[1];
      let i = (backward ? lengs.length - 1 : 0);
      let j = 0;
      const next = () => {
        while (j >= lengs[i]) {
          if (backward) i--;
          else i++;
          j = 0;
        }
        const a = atts[i];
        j++;
        return a;
      };
      return next;
    };

    const oldLen = oldText.length;
    const newLen = newText.length;
    const minLen = Math.min(oldLen, newLen);

    const oldARuns = attribRuns(filterAttribNumbers(oldAttribs, incorpedAttribFilter));
    const newARuns = attribRuns(filterAttribNumbers(newAttribs, incorpedAttribFilter));

    let commonStart = 0;
    const oldStartIter = attribIterator(oldARuns, false);
    const newStartIter = attribIterator(newARuns, false);
    while (commonStart < minLen) {
      if (oldText.charAt(commonStart) === newText.charAt(commonStart) &&
      oldStartIter() === newStartIter()) {
        commonStart++;
      } else { break; }
    }

    let commonEnd = 0;
    const oldEndIter = attribIterator(oldARuns, true);
    const newEndIter = attribIterator(newARuns, true);
    while (commonEnd < minLen) {
      if (commonEnd === 0) {
        // assume newline in common
        oldEndIter();
        newEndIter();
        commonEnd++;
      } else if (
        oldText.charAt(oldLen - 1 - commonEnd) === newText.charAt(newLen - 1 - commonEnd) &&
          oldEndIter() === newEndIter()) {
        commonEnd++;
      } else { break; }
    }

    let hintedCommonEnd = -1;
    if ((typeof optSelEndHint) === 'number') {
      hintedCommonEnd = newLen - optSelEndHint;
    }


    if (commonStart + commonEnd > oldLen) {
      // ambiguous insertion
      const minCommonEnd = oldLen - commonStart;
      const maxCommonEnd = commonEnd;
      if (hintedCommonEnd >= minCommonEnd && hintedCommonEnd <= maxCommonEnd) {
        commonEnd = hintedCommonEnd;
      } else {
        commonEnd = minCommonEnd;
      }
      commonStart = oldLen - commonEnd;
    }
    if (commonStart + commonEnd > newLen) {
      // ambiguous deletion
      const minCommonEnd = newLen - commonStart;
      const maxCommonEnd = commonEnd;
      if (hintedCommonEnd >= minCommonEnd && hintedCommonEnd <= maxCommonEnd) {
        commonEnd = hintedCommonEnd;
      } else {
        commonEnd = minCommonEnd;
      }
      commonStart = newLen - commonEnd;
    }

    return [commonStart, commonEnd];
  };

  const equalLineAndChars = (a, b) => {
    if (!a) return !b;
    if (!b) return !a;
    return (a[0] === b[0] && a[1] === b[1]);
  };

  const performSelectionChange = (selectStart, selectEnd, focusAtStart) => {
    if (repSelectionChange(selectStart, selectEnd, focusAtStart)) {
      currentCallStack.selectionAffected = true;
    }
  };
  editorInfo.ace_performSelectionChange = performSelectionChange;

  // Change the abstract representation of the document to have a different selection.
  // Should not rely on the line representation.  Should not affect the DOM.


  const repSelectionChange = (selectStart, selectEnd, focusAtStart) => {
    focusAtStart = !!focusAtStart;

    const newSelFocusAtStart = (focusAtStart && ((!selectStart) ||
        (!selectEnd) ||
        (selectStart[0] !== selectEnd[0]) ||
        (selectStart[1] !== selectEnd[1])));

    if ((!equalLineAndChars(rep.selStart, selectStart)) ||
        (!equalLineAndChars(rep.selEnd, selectEnd)) ||
        (rep.selFocusAtStart !== newSelFocusAtStart)) {
      rep.selStart = selectStart;
      rep.selEnd = selectEnd;
      rep.selFocusAtStart = newSelFocusAtStart;
      currentCallStack.repChanged = true;

      // select the formatting buttons when there is the style applied on selection
      selectFormattingButtonIfLineHasStyleApplied(rep);

      hooks.callAll('aceSelectionChanged', {
        rep,
        callstack: currentCallStack,
        documentAttributeManager,
      });

      // we scroll when user places the caret at the last line of the pad
      // when this settings is enabled
      const docTextChanged = currentCallStack.docTextChanged;
      if (!docTextChanged) {
        const isScrollableEvent = !isPadLoading(currentCallStack.type) &&
            isScrollableEditEvent(currentCallStack.type);
        const innerHeight = getInnerHeight();
        scroll.scrollWhenCaretIsInTheLastLineOfViewportWhenNecessary(
            rep, isScrollableEvent, innerHeight * 2);
      }

      return true;
    }
    return false;
  };

  const isPadLoading = (t) => t === 'setup' || t === 'setBaseText' || t === 'importText';

  const updateStyleButtonState = (attribName, hasStyleOnRepSelection) => {
    const $formattingButton = window.$(`[data-key="${attribName}"]`).find('a');
    $formattingButton.toggleClass(SELECT_BUTTON_CLASS, hasStyleOnRepSelection);
  };

  const attribIsFormattingStyle = (attribName) => FORMATTING_STYLES.indexOf(attribName) !== -1;

  const selectFormattingButtonIfLineHasStyleApplied = (rep) => {
    for (const style of FORMATTING_STYLES) {
      const hasStyleOnRepSelection =
          documentAttributeManager.hasAttributeOnSelectionOrCaretPosition(style);
      updateStyleButtonState(style, hasStyleOnRepSelection);
    }
  };

  const doCreateDomLine =
      (nonEmpty) => domline.createDomLine(nonEmpty, doesWrap, browser, document);

  const textify =
      (str) => str.replace(/[\n\r ]/g, ' ').replace(/\xa0/g, ' ').replace(/\t/g, '        ');

  const _blockElems = {
    div: 1,
    p: 1,
    pre: 1,
    li: 1,
    ol: 1,
    ul: 1,
  };

  for (const element of hooks.callAll('aceRegisterBlockElements')) _blockElems[element] = 1;

  const isBlockElement = (n) => !!_blockElems[(n.tagName || '').toLowerCase()];
  editorInfo.ace_isBlockElement = isBlockElement;

  const getDirtyRanges = () => {
    // based on observedChanges, return a list of ranges of original lines
    // that need to be removed or replaced with new user content to incorporate
    // the user's changes into the line representation.  ranges may be zero-length,
    // indicating inserted content.  for example, [0,0] means content was inserted
    // at the top of the document, while [3,4] means line 3 was deleted, modified,
    // or replaced with one or more new lines of content. ranges do not touch.

    const cleanNodeForIndexCache = {};
    const N = rep.lines.length(); // old number of lines


    const cleanNodeForIndex = (i) => {
      // if line (i) in the un-updated line representation maps to a clean node
      // in the document, return that node.
      // if (i) is out of bounds, return true. else return false.
      if (cleanNodeForIndexCache[i] === undefined) {
        let result;
        if (i < 0 || i >= N) {
          result = true; // truthy, but no actual node
        } else {
          const key = rep.lines.atIndex(i).key;
          result = (getCleanNodeByKey(key) || false);
        }
        cleanNodeForIndexCache[i] = result;
      }
      return cleanNodeForIndexCache[i];
    };
    const isConsecutiveCache = {};

    const isConsecutive = (i) => {
      if (isConsecutiveCache[i] === undefined) {
        isConsecutiveCache[i] = (() => {
          // returns whether line (i) and line (i-1), assumed to be map to clean DOM nodes,
          // or document boundaries, are consecutive in the changed DOM
          const a = cleanNodeForIndex(i - 1);
          const b = cleanNodeForIndex(i);
          if ((!a) || (!b)) return false; // violates precondition
          if ((a === true) && (b === true)) return !targetBody.firstChild;
          if ((a === true) && b.previousSibling) return false;
          if ((b === true) && a.nextSibling) return false;
          if ((a === true) || (b === true)) return true;
          return a.nextSibling === b;
        })();
      }
      return isConsecutiveCache[i];
    };

    // returns whether line (i) in the un-updated representation maps to a clean node,
    // or is outside the bounds of the document
    const isClean = (i) => !!cleanNodeForIndex(i);

    // list of pairs, each representing a range of lines that is clean and consecutive
    // in the changed DOM.  lines (-1) and (N) are always clean, but may or may not
    // be consecutive with lines in the document.  pairs are in sorted order.
    const cleanRanges = [
      [-1, N + 1],
    ];

    // returns index of cleanRange containing i, or -1 if none
    const rangeForLine = (i) => {
      for (const [idx, r] of cleanRanges.entries()) {
        if (i < r[0]) return -1;
        if (i < r[1]) return idx;
      }
      return -1;
    };

    const removeLineFromRange = (rng, line) => {
      // rng is index into cleanRanges, line is line number
      // precond: line is in rng
      const a = cleanRanges[rng][0];
      const b = cleanRanges[rng][1];
      if ((a + 1) === b) cleanRanges.splice(rng, 1);
      else if (line === a) cleanRanges[rng][0]++;
      else if (line === (b - 1)) cleanRanges[rng][1]--;
      else cleanRanges.splice(rng, 1, [a, line], [line + 1, b]);
    };

    const splitRange = (rng, pt) => {
      // precond: pt splits cleanRanges[rng] into two non-empty ranges
      const a = cleanRanges[rng][0];
      const b = cleanRanges[rng][1];
      cleanRanges.splice(rng, 1, [a, pt], [pt, b]);
    };

    const correctedLines = {};

    const correctlyAssignLine = (line) => {
      if (correctedLines[line]) return true;
      correctedLines[line] = true;
      // "line" is an index of a line in the un-updated rep.
      // returns whether line was already correctly assigned (i.e. correctly
      // clean or dirty, according to cleanRanges, and if clean, correctly
      // attached or not attached (i.e. in the same range as) the prev and next lines).
      const rng = rangeForLine(line);
      const lineClean = isClean(line);
      if (rng < 0) {
        if (lineClean) {
          // somehow lost clean line
        }
        return true;
      }
      if (!lineClean) {
        // a clean-range includes this dirty line, fix it
        removeLineFromRange(rng, line);
        return false;
      } else {
        // line is clean, but could be wrongly connected to a clean line
        // above or below
        const a = cleanRanges[rng][0];
        const b = cleanRanges[rng][1];
        let didSomething = false;
        // we'll leave non-clean adjacent nodes in the clean range for the caller to
        // detect and deal with.  we deal with whether the range should be split
        // just above or just below this line.
        if (a < line && isClean(line - 1) && !isConsecutive(line)) {
          splitRange(rng, line);
          didSomething = true;
        }
        if (b > (line + 1) && isClean(line + 1) && !isConsecutive(line + 1)) {
          splitRange(rng, line + 1);
          didSomething = true;
        }
        return !didSomething;
      }
    };

    const detectChangesAroundLine = (line, reqInARow) => {
      // make sure cleanRanges is correct about line number "line" and the surrounding
      // lines; only stops checking at end of document or after no changes need
      // making for several consecutive lines. note that iteration is over old lines,
      // so this operation takes time proportional to the number of old lines
      // that are changed or missing, not the number of new lines inserted.
      let correctInARow = 0;
      let currentIndex = line;
      while (correctInARow < reqInARow && currentIndex >= 0) {
        if (correctlyAssignLine(currentIndex)) {
          correctInARow++;
        } else { correctInARow = 0; }
        currentIndex--;
      }
      correctInARow = 0;
      currentIndex = line;
      while (correctInARow < reqInARow && currentIndex < N) {
        if (correctlyAssignLine(currentIndex)) {
          correctInARow++;
        } else { correctInARow = 0; }
        currentIndex++;
      }
    };

    if (N === 0) {
      if (!isConsecutive(0)) {
        splitRange(0, 0);
      }
    } else {
      detectChangesAroundLine(0, 1);
      detectChangesAroundLine(N - 1, 1);

      for (const k of Object.keys(observedChanges.cleanNodesNearChanges)) {
        const key = k.substring(1);
        if (rep.lines.containsKey(key)) {
          const line = rep.lines.indexOfKey(key);
          detectChangesAroundLine(line, 2);
        }
      }
    }

    const dirtyRanges = [];
    for (let r = 0; r < cleanRanges.length - 1; r++) {
      dirtyRanges.push([cleanRanges[r][1], cleanRanges[r + 1][0]]);
    }

    return dirtyRanges;
  };

  const markNodeClean = (n) => {
    // clean nodes have knownHTML that matches their innerHTML
    setAssoc(n, 'dirtiness', {nodeId: uniqueId(n), knownHTML: n.innerHTML});
  };

  const isNodeDirty = (n) => {
    if (n.parentNode !== targetBody) return true;
    const data = getAssoc(n, 'dirtiness');
    if (!data) return true;
    if (n.id !== data.nodeId) return true;
    if (n.innerHTML !== data.knownHTML) return true;
    return false;
  };

  const handleClick = (evt) => {
    inCallStackIfNecessary('handleClick', () => {
      idleWorkTimer.atMost(200);
    });

    const isLink = (n) => (n.tagName || '').toLowerCase() === 'a' && n.href;

    // only want to catch left-click
    if ((evt.button !== 2) && (evt.button !== 3)) {
      // find A tag with HREF
      let n = evt.target;
      while (n && n.parentNode && !isLink(n)) {
        n = n.parentNode;
      }
      if (n && isLink(n)) {
        try {
          window.open(n.href, '_blank', 'noopener,noreferrer');
          if (evt.ctrlKey) window.focus();
        } catch (e) {
          // absorb "user canceled" error in IE for certain prompts
        }
        evt.preventDefault();
      }
    }

    hideEditBarDropdowns();
  };

  const hideEditBarDropdowns = () => {
    window.padeditbar.toggleDropDown('none');
  };

  const renumberList = (lineNum) => {
    // 1-check we are in a list
    let type = getLineListType(lineNum);
    if (!type) {
      return null;
    }
    type = /([a-z]+)[0-9]+/.exec(type);
    if (type[1] === 'indent') {
      return null;
    }

    // 2-find the first line of the list
    while (lineNum - 1 >= 0 && (type = getLineListType(lineNum - 1))) {
      type = /([a-z]+)[0-9]+/.exec(type);
      if (type[1] === 'indent') break;
      lineNum--;
    }

    // 3-renumber every list item of the same level from the beginning, level 1
    // IMPORTANT: never skip a level because there imbrication may be arbitrary
    const builder = new Builder(rep.lines.totalWidth());
    let loc = [0, 0];
    const applyNumberList = (line, level) => {
      // init
      let position = 1;
      let curLevel = level;
      let listType;
      // loop over the lines
      while ((listType = getLineListType(line))) {
        // apply new num
        listType = /([a-z]+)([0-9]+)/.exec(listType);
        curLevel = Number(listType[2]);
        if (isNaN(curLevel) || listType[0] === 'indent') {
          return line;
        } else if (curLevel === level) {
          buildKeepRange(rep, builder, loc, (loc = [line, 0]));
          buildKeepRange(rep, builder, loc, (loc = [line, 1]), [
            ['start', position],
          ], rep.apool);

          position++;
          line++;
        } else if (curLevel < level) {
          return line;// back to parent
        } else {
          line = applyNumberList(line, level + 1);// recursive call
        }
      }
      return line;
    };

    applyNumberList(lineNum, 1);
    const cs = builder.toString();
    if (!isIdentity(cs)) {
      performDocumentApplyChangeset(cs);
    }

    // 4-apply the modifications
  };
  editorInfo.ace_renumberList = renumberList;

  const setLineListType = (lineNum, listType) => {
    if (listType === '') {
      documentAttributeManager.removeAttributeOnLine(lineNum, listAttributeName);
      documentAttributeManager.removeAttributeOnLine(lineNum, 'start');
    } else {
      documentAttributeManager.setAttributeOnLine(lineNum, listAttributeName, listType);
    }

    // if the list has been removed, it is necessary to renumber
    // starting from the *next* line because the list may have been
    // separated. If it returns null, it means that the list was not cut, try
    // from the current one.
    if (renumberList(lineNum + 1) == null) {
      renumberList(lineNum);
    }
  };

  const doReturnKey = () => {
    if (!(rep.selStart && rep.selEnd)) {
      return;
    }

    const lineNum = rep.selStart[0];
    let listType = getLineListType(lineNum);

    if (listType) {
      const text = rep.lines.atIndex(lineNum).text;
      listType = /([a-z]+)([0-9]+)/.exec(listType);
      const type = listType[1];
      const level = Number(listType[2]);

      // detect empty list item; exclude indentation
      if (text === '*' && type !== 'indent') {
        // if not already on the highest level
        if (level > 1) {
          setLineListType(lineNum, type + (level - 1));// automatically decrease the level
        } else {
          setLineListType(lineNum, '');// remove the list
          renumberList(lineNum + 1);// trigger renumbering of list that may be right after
        }
      } else if (lineNum + 1 <= rep.lines.length()) {
        performDocumentReplaceSelection('\n');
        setLineListType(lineNum + 1, type + level);
      }
    } else {
      performDocumentReplaceSelection('\n');
      handleReturnIndentation();
    }
  };
  editorInfo.ace_doReturnKey = doReturnKey;

  const doIndentOutdent = (isOut) => {
    if (!((rep.selStart && rep.selEnd) ||
          (rep.selStart[0] === rep.selEnd[0] &&
           rep.selStart[1] === rep.selEnd[1] &&
           rep.selEnd[1] > 1)) &&
        isOut !== true) {
      return false;
    }

    const firstLine = rep.selStart[0];
    const lastLine = Math.max(firstLine, rep.selEnd[0] - ((rep.selEnd[1] === 0) ? 1 : 0));
    const mods = [];
    for (let n = firstLine; n <= lastLine; n++) {
      let listType = getLineListType(n);
      let t = 'indent';
      let level = 0;
      if (listType) {
        listType = /([a-z]+)([0-9]+)/.exec(listType);
        if (listType) {
          t = listType[1];
          level = Number(listType[2]);
        }
      }
      const newLevel = Math.max(0, Math.min(MAX_LIST_LEVEL, level + (isOut ? -1 : 1)));
      if (level !== newLevel) {
        mods.push([n, (newLevel > 0) ? t + newLevel : '']);
      }
    }

    for (const mod of mods) setLineListType(mod[0], mod[1]);
    return true;
  };
  editorInfo.ace_doIndentOutdent = doIndentOutdent;

  const doTabKey = (shiftDown) => {
    if (!doIndentOutdent(shiftDown)) {
      performDocumentReplaceSelection(THE_TAB);
    }
  };

  const doDeleteKey = (optEvt) => {
    const evt = optEvt || {};
    let handled = false;
    if (rep.selStart) {
      if (isCaret()) {
        const lineNum = caretLine();
        const col = caretColumn();
        const lineEntry = rep.lines.atIndex(lineNum);
        const lineText = lineEntry.text;
        const lineMarker = lineEntry.lineMarker;
        if (evt.metaKey && col > lineMarker) {
          // cmd-backspace deletes to start of line (if not already at start)
          performDocumentReplaceRange([lineNum, lineMarker], [lineNum, col], '');
          handled = true;
        } else if (/^ +$/.exec(lineText.substring(lineMarker, col))) {
          const col2 = col - lineMarker;
          const tabSize = THE_TAB.length;
          const toDelete = ((col2 - 1) % tabSize) + 1;
          performDocumentReplaceRange([lineNum, col - toDelete], [lineNum, col], '');
          handled = true;
        }
      }
      if (!handled) {
        if (isCaret()) {
          const theLine = caretLine();
          const lineEntry = rep.lines.atIndex(theLine);
          if (caretColumn() <= lineEntry.lineMarker) {
            // delete at beginning of line
            const prevLineListType = (theLine > 0 ? getLineListType(theLine - 1) : '');
            const thisLineListType = getLineListType(theLine);
            const prevLineEntry = (theLine > 0 && rep.lines.atIndex(theLine - 1));
            const prevLineBlank = (prevLineEntry &&
                prevLineEntry.text.length === prevLineEntry.lineMarker);

            const thisLineHasMarker = documentAttributeManager.lineHasMarker(theLine);

            if (thisLineListType) {
              // this line is a list
              if (prevLineBlank && !prevLineListType) {
                // previous line is blank, remove it
                performDocumentReplaceRange(
                    [theLine - 1, prevLineEntry.text.length], [theLine, 0], '');
              } else {
                // delistify
                performDocumentReplaceRange([theLine, 0], [theLine, lineEntry.lineMarker], '');
              }
            } else if (thisLineHasMarker && prevLineEntry) {
              // If the line has any attributes assigned, remove them by removing the marker '*'
              performDocumentReplaceRange(
                  [theLine - 1, prevLineEntry.text.length], [theLine, lineEntry.lineMarker], '');
            } else if (theLine > 0) {
              // remove newline
              performDocumentReplaceRange(
                  [theLine - 1, prevLineEntry.text.length], [theLine, 0], '');
            }
          } else {
            const docChar = caretDocChar();
            if (docChar > 0) {
              if (evt.metaKey || evt.ctrlKey || evt.altKey) {
                // delete as many unicode "letters or digits" in a row as possible;
                // always delete one char, delete further even if that first char
                // isn't actually a word char.
                let deleteBackTo = docChar - 1;
                while (deleteBackTo > lineEntry.lineMarker &&
                  isWordChar(rep.alltext.charAt(deleteBackTo - 1))) {
                  deleteBackTo--;
                }
                performDocumentReplaceCharRange(deleteBackTo, docChar, '');
              } else {
                // normal delete
                performDocumentReplaceCharRange(docChar - 1, docChar, '');
              }
            }
          }
        } else {
          performDocumentReplaceSelection('');
        }
      }
    }
    // if the list has been removed, it is necessary to renumber
    // starting from the *next* line because the list may have been
    // separated. If it returns null, it means that the list was not cut, try
    // from the current one.
    const line = caretLine();
    if (line !== -1 && renumberList(line + 1) == null) {
      renumberList(line);
    }
  };

  const isWordChar = (c) => padutils.wordCharRegex.test(c);
  editorInfo.ace_isWordChar = isWordChar;

  const handleKeyEvent = (evt) => {
    if (!isEditable) return;
    const {type, charCode, keyCode, which, shiftKey} = evt;

    // If DOM3 support exists, ensure that the left ALT key was pressed. This
    // allows keyboard layouts with special meaning for right-alt-char to
    // continue working on Firefox / macOS.
    let altKey = evt.altKey;
    if (evt.originalEvent.location !== undefined) {
        altKey = altKey && evt.originalEvent.location === evt.originalEvent.DOM_KEY_LOCATION_LEFT;
    }

    // Don't take action based on modifier keys going up and down.
    // Modifier keys do not generate "keypress" events.
    // 224 is the command-key under Mac Firefox.
    // 91 is the Windows key in IE; it is ASCII for open-bracket but isn't the keycode for that key
    // 20 is capslock in IE.
    const isModKey = !charCode && (type === 'keyup' || type === 'keydown') &&
        (keyCode === 16 || keyCode === 17 || keyCode === 18 ||
         keyCode === 20 || keyCode === 224 || keyCode === 91);
    if (isModKey) return;

    // If the key is a keypress and the browser is opera and the key is enter,
    // do nothign at all as this fires twice.
    if (keyCode === 13 && browser.opera && type === 'keypress') {
      // This stops double enters in Opera but double Tabs still show on single
      // tab keypress, adding keyCode == 9 to this doesn't help as the event is fired twice
      return;
    }

    const isTypeForSpecialKey = browser.safari || browser.chrome || browser.firefox
      ? type === 'keydown' : type === 'keypress';
    const isTypeForCmdKey = browser.safari || browser.chrome || browser.firefox
      ? type === 'keydown' : type === 'keypress';

    let stopped = false;

    inCallStackIfNecessary('handleKeyEvent', function () {
      if (type === 'keypress' || (isTypeForSpecialKey && keyCode === 13 /* return*/)) {
        // in IE, special keys don't send keypress, the keydown does the action
        if (!outsideKeyPress(evt)) {
          evt.preventDefault();
          stopped = true;
        }
      } else if (evt.key === 'Dead') {
        // If it's a dead key we don't want to do any Etherpad behavior.
        stopped = true;
        return true;
      } else if (type === 'keydown') {
        outsideKeyDown(evt);
      }
      let specialHandled = false;
      if (!stopped) {
        const specialHandledInHook = hooks.callAll('aceKeyEvent', {
          callstack: currentCallStack,
          editorInfo,
          rep,
          documentAttributeManager,
          evt,
        });

        // if any hook returned true, set specialHandled with true
        if (specialHandledInHook) {
          specialHandled = specialHandledInHook.indexOf(true) !== -1;
        }

        const padShortcutEnabled = window.clientVars.padShortcutEnabled;
        if (!specialHandled && isTypeForSpecialKey &&
            altKey && keyCode === 120 &&
            padShortcutEnabled.altF9) {
          // Alt F9 focuses on the File Menu and/or editbar.
          // Note that while most editors use Alt F10 this is not desirable
          // As ubuntu cannot use Alt F10....
          // Focus on the editbar.
          // -- TODO: Move Focus back to previous state (we know it so we can use it)
          const firstEditbarElement = window.$('#editbar')
              .children('ul').first().children().first()
              .children().first().children().first();
          $(this).trigger('blur');
          firstEditbarElement.trigger('focus');
          evt.preventDefault();
        }
        if (!specialHandled && type === 'keydown' &&
            altKey && keyCode === 67 &&
            padShortcutEnabled.altC) {
          // Alt c focuses on the Chat window
          $(this).trigger('blur');
          window.chat.show();
          window.$('#chatinput').trigger('focus');
          evt.preventDefault();
        }
        if (!specialHandled && type === 'keydown' &&
            evt.ctrlKey && shiftKey && keyCode === 50 &&
            padShortcutEnabled.cmdShift2) {
          // Control-Shift-2 shows a gritter popup showing a line author
          const lineNumber = rep.selEnd[0];
          const alineAttrs = rep.alines[lineNumber];
          const apool = rep.apool;

          // TODO: support selection ranges
          // TODO: Still work when authorship colors have been cleared
          // TODO: i18n
          // TODO: There appears to be a race condition or so.
          const authorIds = new Set();
          if (alineAttrs) {
            for (const op of deserializeOps(alineAttrs)) {
              const authorId = AttributeMap.fromString(op.attribs, apool).get('author');
              if (authorId) authorIds.add(authorId);
            }
          }
          const idToName = new Map(window.pad.userList().map((a) => [a.userId, a.name]));
          const myId = window.clientVars.userId;
          const authors =
              [...authorIds].map((id) => id === myId ? 'me' : idToName.get(id) || 'unknown');

          window.$.gritter.add({
            title: 'Line Authors',
            text:
                authors.length === 0 ? 'No author information is available'
                : authors.length === 1 ? `The author of this line is ${authors[0]}`
                : `The authors of this line are ${authors.join(' & ')}`,
            sticky: false,
            time: '4000',
          });
        }
        if (!specialHandled && isTypeForSpecialKey &&
            keyCode === 8 &&
            padShortcutEnabled.delete) {
          // "delete" key; in mozilla, if we're at the beginning of a line, normalize now,
          // or else deleting a blank line can take two delete presses.
          // --
          // we do deletes completely customly now:
          //  - allows consistent (and better) meta-delete behavior
          //  - normalizing and then allowing default behavior confused IE
          //  - probably eliminates a few minor quirks
          fastIncorp(3);
          evt.preventDefault();
          doDeleteKey(evt);
          specialHandled = true;
        }
        if (!specialHandled && isTypeForSpecialKey &&
            keyCode === 13 &&
            padShortcutEnabled.return) {
          // return key, handle specially;
          // note that in mozilla we need to do an incorporation for proper return behavior anyway.
          fastIncorp(4);
          evt.preventDefault();
          doReturnKey();
          scheduler.setTimeout(() => {
            outerWin.scrollBy(-100, 0);
          }, 0);
          specialHandled = true;
        }
        if (!specialHandled && isTypeForSpecialKey &&
            keyCode === 27 &&
            padShortcutEnabled.esc) {
          // prevent esc key;
          // in mozilla versions 14-19 avoid reconnecting pad.

          fastIncorp(4);
          evt.preventDefault();
          specialHandled = true;

          // close all gritters when the user hits escape key
          window.$.gritter.removeAll();
        }
        if (!specialHandled && isTypeForCmdKey &&
            /* Do a saved revision on ctrl S */
            (evt.metaKey || evt.ctrlKey) && String.fromCharCode(which).toLowerCase() === 's' &&
            !evt.altKey &&
            padShortcutEnabled.cmdS) {
          evt.preventDefault();
          const originalBackground = window.$('#revisionlink').css('background');
          window.$('#revisionlink').css({background: 'lightyellow'});
          scheduler.setTimeout(() => {
            window.$('#revisionlink').css({background: originalBackground});
          }, 1000);

          window.pad.collabClient.sendMessage({type: 'SAVE_REVISION'});
          specialHandled = true;
        }
        if (!specialHandled && isTypeForSpecialKey &&
            // tab
            keyCode === 9 &&
            !(evt.metaKey || evt.ctrlKey) &&
            padShortcutEnabled.tab) {
          fastIncorp(5);
          evt.preventDefault();
          doTabKey(evt.shiftKey);
          specialHandled = true;
        }
        if (!specialHandled && isTypeForCmdKey &&
            // cmd-Z (undo)
            (evt.metaKey || evt.ctrlKey) && String.fromCharCode(which).toLowerCase() === 'z' &&
            !evt.altKey &&
            padShortcutEnabled.cmdZ) {
          fastIncorp(6);
          evt.preventDefault();
          if (evt.shiftKey) {
            doUndoRedo('redo');
          } else {
            doUndoRedo('undo');
          }
          specialHandled = true;
        }
        if (!specialHandled && isTypeForCmdKey &&
            // cmd-Y (redo)
            (evt.metaKey || evt.ctrlKey) && String.fromCharCode(which).toLowerCase() === 'y' &&
            padShortcutEnabled.cmdY) {
          fastIncorp(10);
          evt.preventDefault();
          doUndoRedo('redo');
          specialHandled = true;
        }
        if (!specialHandled && isTypeForCmdKey &&
            // cmd-B (bold)
            (evt.metaKey || evt.ctrlKey) && String.fromCharCode(which).toLowerCase() === 'b' &&
            padShortcutEnabled.cmdB) {
          fastIncorp(13);
          evt.preventDefault();
          toggleAttributeOnSelection('bold');
          specialHandled = true;
        }
        if (!specialHandled && isTypeForCmdKey &&
            // cmd-I (italic)
            (evt.metaKey || evt.ctrlKey) && String.fromCharCode(which).toLowerCase() === 'i' &&
            padShortcutEnabled.cmdI) {
          fastIncorp(14);
          evt.preventDefault();
          toggleAttributeOnSelection('italic');
          specialHandled = true;
        }
        if (!specialHandled && isTypeForCmdKey &&
            // cmd-U (underline)
            (evt.metaKey || evt.ctrlKey) && String.fromCharCode(which).toLowerCase() === 'u' &&
            padShortcutEnabled.cmdU) {
          fastIncorp(15);
          evt.preventDefault();
          toggleAttributeOnSelection('underline');
          specialHandled = true;
        }
        if (!specialHandled && isTypeForCmdKey &&
            // cmd-5 (strikethrough)
            (evt.metaKey || evt.ctrlKey) && String.fromCharCode(which).toLowerCase() === '5' &&
            evt.altKey !== true &&
            padShortcutEnabled.cmd5) {
          fastIncorp(13);
          evt.preventDefault();
          toggleAttributeOnSelection('strikethrough');
          specialHandled = true;
        }
        if (!specialHandled && isTypeForCmdKey &&
            // cmd-shift-L (unorderedlist)
            (evt.metaKey || evt.ctrlKey) && String.fromCharCode(which).toLowerCase() === 'l' &&
            evt.shiftKey &&
            padShortcutEnabled.cmdShiftL) {
          fastIncorp(9);
          evt.preventDefault();
          doInsertUnorderedList();
          specialHandled = true;
        }
        if (!specialHandled && isTypeForCmdKey &&
            // cmd-shift-N and cmd-shift-1 (orderedlist)
            (evt.metaKey || evt.ctrlKey) && evt.shiftKey &&
            ((String.fromCharCode(which).toLowerCase() === 'n' && padShortcutEnabled.cmdShiftN) ||
             (String.fromCharCode(which) === '1' && padShortcutEnabled.cmdShift1))) {
          fastIncorp(9);
          evt.preventDefault();
          doInsertOrderedList();
          specialHandled = true;
        }
        if (!specialHandled && isTypeForCmdKey &&
            // cmd-shift-C (clearauthorship)
            (evt.metaKey || evt.ctrlKey) && evt.shiftKey &&
            String.fromCharCode(which).toLowerCase() === 'c' &&
            padShortcutEnabled.cmdShiftC) {
          fastIncorp(9);
          evt.preventDefault();
          CMDS.clearauthorship();
        }
        if (!specialHandled && isTypeForCmdKey &&
            // cmd-H (backspace)
            (evt.ctrlKey) && String.fromCharCode(which).toLowerCase() === 'h' &&
            padShortcutEnabled.cmdH) {
          fastIncorp(20);
          evt.preventDefault();
          doDeleteKey();
          specialHandled = true;
        }
        if (evt.ctrlKey === true && evt.which === 36 &&
            // Control Home send to Y = 0
            padShortcutEnabled.ctrlHome) {
          scroll.setScrollY(0);
        }
        if ((evt.which === 33 || evt.which === 34) && type === 'keydown' && !evt.ctrlKey) {
          // This is required, browsers will try to do normal default behavior on
          // page up / down and the default behavior SUCKS
          evt.preventDefault();
          const oldVisibleLineRange = scroll.getVisibleLineRange(rep);
          let topOffset = rep.selStart[0] - oldVisibleLineRange[0];
          if (topOffset < 0) {
            topOffset = 0;
          }

          const isPageDown = evt.which === 34;
          const isPageUp = evt.which === 33;

          scheduler.setTimeout(() => {
            // the visible lines IE 1,10
            const newVisibleLineRange = scroll.getVisibleLineRange(rep);
            // total count of lines in pad IE 10
            const linesCount = rep.lines.length();
            // How many lines are in the viewport right now?
            const numberOfLinesInViewport = newVisibleLineRange[1] - newVisibleLineRange[0];

            if (isPageUp && padShortcutEnabled.pageUp) {
              // move to the bottom line +1 in the viewport (essentially skipping over a page)
              rep.selEnd[0] -= numberOfLinesInViewport;
              // move to the bottom line +1 in the viewport (essentially skipping over a page)
              rep.selStart[0] -= numberOfLinesInViewport;
            }

            // if we hit page down
            if (isPageDown && padShortcutEnabled.pageDown) {
              // If the new viewpoint position is actually further than where we are right now
              if (rep.selEnd[0] >= oldVisibleLineRange[0]) {
                // dont go further in the page down than what's visible IE go from 0 to 50
                //  if 50 is visible on screen but dont go below that else we miss content
                rep.selStart[0] = oldVisibleLineRange[1] - 1;
                // dont go further in the page down than what's visible IE go from 0 to 50
                // if 50 is visible on screen but dont go below that else we miss content
                rep.selEnd[0] = oldVisibleLineRange[1] - 1;
              }
            }

            // ensure min and max
            if (rep.selEnd[0] < 0) {
              rep.selEnd[0] = 0;
            }
            if (rep.selStart[0] < 0) {
              rep.selStart[0] = 0;
            }
            if (rep.selEnd[0] >= linesCount) {
              rep.selEnd[0] = linesCount - 1;
            }
            updateBrowserSelectionFromRep();
            // get the current caret selection, can't use rep. here because that only gives
            // us the start position not the current
            const myselection = targetDoc.getSelection();
            // get the carets selection offset in px IE 214
            let caretOffsetTop = myselection.focusNode.parentNode.offsetTop ||
                myselection.focusNode.offsetTop;

            // sometimes the first selection is -1 which causes problems
            // (Especially with ep_page_view)
            // so use focusNode.offsetTop value.
            if (caretOffsetTop === -1) caretOffsetTop = myselection.focusNode.offsetTop;
            // set the scrollY offset of the viewport on the document
            scroll.setScrollY(caretOffsetTop);
          }, 200);
        }
      }

      if (type === 'keydown') {
        idleWorkTimer.atLeast(500);
      } else if (type === 'keypress') {
        // OPINION ASKED.  What's going on here? :D
        if (!specialHandled) {
          idleWorkTimer.atMost(0);
        } else {
          idleWorkTimer.atLeast(500);
        }
      } else if (type === 'keyup') {
        const wait = 0;
        idleWorkTimer.atLeast(wait);
        idleWorkTimer.atMost(wait);
      }

      // Is part of multi-keystroke international character on Firefox Mac
      const isFirefoxHalfCharacter =
          (browser.firefox && evt.altKey && charCode === 0 && keyCode === 0);

      // Is part of multi-keystroke international character on Safari Mac
      const isSafariHalfCharacter =
          (browser.safari && evt.altKey && keyCode === 229);

      if (thisKeyDoesntTriggerNormalize || isFirefoxHalfCharacter || isSafariHalfCharacter) {
        idleWorkTimer.atLeast(3000); // give user time to type
        // if this is a keydown, e.g., the keyup shouldn't trigger a normalize
        thisKeyDoesntTriggerNormalize = true;
      }

      if (!specialHandled && !thisKeyDoesntTriggerNormalize && !inInternationalComposition &&
          type !== 'keyup') {
        observeChangesAroundSelection();
      }

      if (type === 'keyup') {
        thisKeyDoesntTriggerNormalize = false;
      }
    });
  };

  let thisKeyDoesntTriggerNormalize = false;

  const doUndoRedo = (which) => {
    // precond: normalized DOM
    if (undoModule.enabled) {
      let whichMethod;
      if (which === 'undo') whichMethod = 'performUndo';
      if (which === 'redo') whichMethod = 'performRedo';
      if (whichMethod) {
        const oldEventType = currentCallStack.editEvent.eventType;
        currentCallStack.startNewEvent(which);
        undoModule[whichMethod]((backset, selectionInfo) => {
          if (backset) {
            performDocumentApplyChangeset(backset);
          }
          if (selectionInfo) {
            performSelectionChange(
                lineAndColumnFromChar(selectionInfo.selStart),
                lineAndColumnFromChar(selectionInfo.selEnd),
                selectionInfo.selFocusAtStart);
          }
          const oldEvent = currentCallStack.startNewEvent(oldEventType, true);
          return oldEvent;
        });
      }
    }
  };
  editorInfo.ace_doUndoRedo = doUndoRedo;

  const setSelection = (selection) => {
    const copyPoint = (pt) => ({
      node: pt.node,
      index: pt.index,
      maxIndex: pt.maxIndex,
    });
    let isCollapsed;

    const pointToRangeBound = (pt) => {
      const p = copyPoint(pt);
      // Make sure Firefox cursor is deep enough; fixes cursor jumping when at top level,
      // and also problem where cut/copy of a whole line selected with fake arrow-keys
      // copies the next line too.
      if (isCollapsed) {
        const diveDeep = () => {
          while (p.node.childNodes.length > 0) {
            if (p.index === 0) {
              p.node = p.node.firstChild;
              p.maxIndex = nodeMaxIndex(p.node);
            } else if (p.index === p.maxIndex) {
              p.node = p.node.lastChild;
              p.maxIndex = nodeMaxIndex(p.node);
              p.index = p.maxIndex;
            } else { break; }
          }
        };
        // now fix problem where cursor at end of text node at end of span-like element
        // with background doesn't seem to show up...
        if (isNodeText(p.node) && p.index === p.maxIndex) {
          let n = p.node;
          while (!n.nextSibling && n !== targetBody && n.parentNode !== targetBody) {
            n = n.parentNode;
          }
          if (n.nextSibling &&
              !(typeof n.nextSibling.tagName === 'string' &&
                n.nextSibling.tagName.toLowerCase() === 'br') &&
              n !== p.node && n !== targetBody && n.parentNode !== targetBody) {
            // found a parent, go to next node and dive in
            p.node = n.nextSibling;
            p.maxIndex = nodeMaxIndex(p.node);
            p.index = 0;
            diveDeep();
          }
        }
        // try to make sure insertion point is styled;
        // also fixes other FF problems
        if (!isNodeText(p.node)) {
          diveDeep();
        }
      }
      if (isNodeText(p.node)) {
        return {
          container: p.node,
          offset: p.index,
        };
      } else {
        // p.index in {0,1}
        return {
          container: p.node.parentNode,
          offset: childIndex(p.node) + p.index,
        };
      }
    };
    const browserSelection = targetDoc.getSelection();
    if (browserSelection) {
      browserSelection.removeAllRanges();
      if (selection) {
        isCollapsed = (selection.startPoint.node === selection.endPoint.node &&
                       selection.startPoint.index === selection.endPoint.index);
        const start = pointToRangeBound(selection.startPoint);
        const end = pointToRangeBound(selection.endPoint);

        if (!isCollapsed && selection.focusAtStart &&
            browserSelection.collapse && browserSelection.extend) {
          // can handle "backwards"-oriented selection, shift-arrow-keys move start
          // of selection
          browserSelection.collapse(end.container, end.offset);
          browserSelection.extend(start.container, start.offset);
        } else {
          const range = document.createRange();
          range.setStart(start.container, start.offset);
          range.setEnd(end.container, end.offset);
          browserSelection.removeAllRanges();
          browserSelection.addRange(range);
        }
      }
    }
  };

  const updateBrowserSelectionFromRep = () => {
    // requires normalized DOM!
    const selStart = rep.selStart;
    const selEnd = rep.selEnd;

    if (!(selStart && selEnd)) {
      setSelection(null);
      return;
    }

    const selection = {};

    const ss = [selStart[0], selStart[1]];
    selection.startPoint = getPointForLineAndChar(ss);

    const se = [selEnd[0], selEnd[1]];
    selection.endPoint = getPointForLineAndChar(se);

    selection.focusAtStart = !!rep.selFocusAtStart;
    setSelection(selection);
  };
  editorInfo.ace_updateBrowserSelectionFromRep = updateBrowserSelectionFromRep;
  editorInfo.ace_focus = focus;
  editorInfo.ace_importText = importText;
  editorInfo.ace_importAText = importAText;
  editorInfo.ace_exportText = exportText;
  editorInfo.ace_editorChangedSize = editorChangedSize;
  editorInfo.ace_setOnKeyPress = setOnKeyPress;
  editorInfo.ace_setOnKeyDown = setOnKeyDown;
  editorInfo.ace_setNotifyDirty = setNotifyDirty;
  editorInfo.ace_dispose = dispose;
  editorInfo.ace_setEditable = setEditable;
  editorInfo.ace_execCommand = execCommand;
  editorInfo.ace_replaceRange = replaceRange;
  editorInfo.ace_getAuthorInfos = getAuthorInfos;
  editorInfo.ace_performDocumentReplaceRange = performDocumentReplaceRange;
  editorInfo.ace_performDocumentReplaceCharRange = performDocumentReplaceCharRange;
  editorInfo.ace_setSelection = setSelection;

  const nodeMaxIndex = (nd) => {
    if (isNodeText(nd)) return nd.nodeValue.length;
    else return 1;
  };

  const getSelection = () => {
    // returns null, or a structure containing startPoint and endPoint,
    // each of which has node (a magicdom node), index, and maxIndex.  If the node
    // is a text node, maxIndex is the length of the text; else maxIndex is 1.
    // index is between 0 and maxIndex, inclusive.
    const browserSelection = targetDoc.getSelection();
    if (!browserSelection || browserSelection.type === 'None' ||
        browserSelection.rangeCount === 0) {
      return null;
    }
    const range = browserSelection.getRangeAt(0);

    const isInBody = (n) => {
      while (n && !(n.tagName && n.tagName.toLowerCase() === 'body')) {
        n = n.parentNode;
      }
      return !!n;
    };

    const pointFromRangeBound = (container, offset) => {
      if (!isInBody(container)) {
        // command-click in Firefox selects whole document, HEAD and BODY!
        return {
          node: targetBody,
          index: 0,
          maxIndex: 1,
        };
      }
      const n = container;
      const childCount = n.childNodes.length;
      if (isNodeText(n)) {
        return {
          node: n,
          index: offset,
          maxIndex: n.nodeValue.length,
        };
      } else if (childCount === 0) {
        return {
          node: n,
          index: 0,
          maxIndex: 1,
        };
      // treat point between two nodes as BEFORE the second (rather than after the first)
      // if possible; this way point at end of a line block-element is treated as
      // at beginning of next line
      } else if (offset === childCount) {
        const nd = n.childNodes.item(childCount - 1);
        const max = nodeMaxIndex(nd);
        return {
          node: nd,
          index: max,
          maxIndex: max,
        };
      } else {
        const nd = n.childNodes.item(offset);
        const max = nodeMaxIndex(nd);
        return {
          node: nd,
          index: 0,
          maxIndex: max,
        };
      }
    };
    const selection = {
      startPoint: pointFromRangeBound(range.startContainer, range.startOffset),
      endPoint: pointFromRangeBound(range.endContainer, range.endOffset),
      focusAtStart:
          (range.startContainer !== range.endContainer || range.startOffset !== range.endOffset) &&
          browserSelection.anchorNode &&
          browserSelection.anchorNode === range.endContainer &&
          browserSelection.anchorOffset === range.endOffset,
    };

    if (selection.startPoint.node.ownerDocument !== targetDoc) {
      return null;
    }

    return selection;
  };

  const childIndex = (n) => {
    let idx = 0;
    while (n.previousSibling) {
      idx++;
      n = n.previousSibling;
    }
    return idx;
  };

  const fixView = () => {
    // calling this method repeatedly should be fast
    if (getInnerWidth() === 0 || getInnerHeight() === 0) {
      return;
    }

    enforceEditability();

    $(sideDiv).addClass('sidedivdelayed');
  };

  const _teardownActions = [];

  const teardown = () => { for (const a of _teardownActions) a(); };

  let inInternationalComposition = null;
  editorInfo.ace_getInInternationalComposition = () => inInternationalComposition;

  const bindTheEventHandlers = () => {
    $(targetDoc).on('keydown', handleKeyEvent);
    $(targetDoc).on('keypress', handleKeyEvent);
    $(targetDoc).on('keyup', handleKeyEvent);
    $(targetDoc).on('click', handleClick);
    // dropdowns on edit bar need to be closed on clicks on both pad inner and pad outer
    $(outerDoc).on('click', hideEditBarDropdowns);

    // If non-nullish, pasting on a link should be suppressed.
    let suppressPasteOnLink = null;

    $(targetBody).on('auxclick', (e) => {
      if (e.originalEvent.button === 1 && (e.target.a || e.target.localName === 'a')) {
        // The user middle-clicked on a link. Usually users do this to open a link in a new tab, but
        // in X11 (Linux) this will instead paste the contents of the primary selection at the mouse
        // cursor. Users almost certainly do not want to paste when middle-clicking on a link, so
        // tell the 'paste' event handler to suppress the paste. This is done by starting a
        // short-lived timer that suppresses paste (when the target is a link) until either the
        // paste event arrives or the timer fires.
        //
        // Why it is implemented this way:
        //   * Users want to be able to paste on a link via Ctrl-V, the Edit menu, or the context
        //     menu (https://github.com/ether/etherpad-lite/issues/2775) so we cannot simply
        //     suppress all paste actions when the target is a link.
        //   * Non-X11 systems do not paste when the user middle-clicks, so the paste suppression
        //     must be self-resetting.
        //   * On non-X11 systems, middle click should continue to open the link in a new tab.
        //     Suppressing the middle click here in the 'auxclick' handler (via e.preventDefault())
        //     would break that behavior.
        suppressPasteOnLink = scheduler.setTimeout(() => { suppressPasteOnLink = null; }, 0);
      }
    });

    $(targetBody).on('paste', (e) => {
      if (suppressPasteOnLink != null && (e.target.a || e.target.localName === 'a')) {
        scheduler.clearTimeout(suppressPasteOnLink);
        suppressPasteOnLink = null;
        e.preventDefault();
        return;
      }

      // Call paste hook
      hooks.callAll('acePaste', {
        editorInfo,
        rep,
        documentAttributeManager,
        e,
      });
    });

    // We reference document here, this is because if we don't this will expose a bug
    // in Google Chrome.  This bug will cause the last character on the last line to
    // not fire an event when dropped into..
    $(targetBody).on('drop', (e) => {
      if (e.target.a || e.target.localName === 'a') {
        e.preventDefault();
      }

      // Bug fix: when user drags some content and drop it far from its origin, we
      // need to merge the changes into a single changeset. So mark origin with <style>,
      // in order to make content be observed by incorporateUserChanges() (see
      // observeSuspiciousNodes() for more info)
      const selection = getSelection();
      if (selection) {
        const firstLineSelected = topLevel(selection.startPoint.node);
        const lastLineSelected = topLevel(selection.endPoint.node);

        const lineBeforeSelection = firstLineSelected.previousSibling;
        const lineAfterSelection = lastLineSelected.nextSibling;

        const neighbor = lineBeforeSelection || lineAfterSelection;
        neighbor.appendChild(targetDoc.createElement('style'));
      }

      // Call drop hook
      hooks.callAll('aceDrop', {
        editorInfo,
        rep,
        documentAttributeManager,
        e,
      });
    });

    $(targetDoc.documentElement).on('compositionstart', () => {
      if (inInternationalComposition) return;
      inInternationalComposition = new Promise((resolve) => {
        $(targetDoc.documentElement).one('compositionend', () => {
          inInternationalComposition = null;
          resolve();
        });
      });
    });
  };

  const topLevel = (n) => {
    if ((!n) || n === targetBody) return null;
    while (n.parentNode !== targetBody) {
      n = n.parentNode;
    }
    return n;
  };

  const getSelectionPointX = (point) => {
    // doesn't work in wrap-mode
    const node = point.node;
    const index = point.index;
    const leftOf = (n) => n.offsetLeft;
    const rightOf = (n) => n.offsetLeft + n.offsetWidth;

    if (!isNodeText(node)) {
      if (index === 0) return leftOf(node);
      else return rightOf(node);
    } else {
      // we can get bounds of element nodes, so look for those.
      // allow consecutive text nodes for robustness.
      let charsToLeft = index;
      let charsToRight = node.nodeValue.length - index;
      let n;
      for (n = node.previousSibling; n && isNodeText(n); n = n.previousSibling) {
        charsToLeft += n.nodeValue;
      }
      const leftEdge = (n ? rightOf(n) : leftOf(node.parentNode));
      for (n = node.nextSibling; n && isNodeText(n); n = n.nextSibling) charsToRight += n.nodeValue;
      const rightEdge = (n ? leftOf(n) : rightOf(node.parentNode));
      const frac = (charsToLeft / (charsToLeft + charsToRight));
      const pixLoc = leftEdge + frac * (rightEdge - leftEdge);
      return Math.round(pixLoc);
    }
  };

  const getInnerHeight = () => {
    const h = browser.opera ? outerWin.innerHeight : outerDoc.documentElement.clientHeight;
    if (h) return h;

    // deal with case where iframe is hidden, hope that
    // style.height of iframe container is set in px
    return Number(editorInfo.frame.parentNode.style.height.replace(/[^0-9]/g, '') || 0);
  };

  const getInnerWidth = () => outerDoc.documentElement.clientWidth;

  const scrollXHorizontallyIntoView = (pixelX) => {
    const distInsideLeft = pixelX - outerWin.scrollX;
    const distInsideRight = outerWin.scrollX + getInnerWidth() - pixelX;
    if (distInsideLeft < 0) {
      outerWin.scrollBy(distInsideLeft, 0);
    } else if (distInsideRight < 0) {
      outerWin.scrollBy(-distInsideRight + 1, 0);
    }
  };

  const scrollSelectionIntoView = () => {
    if (!rep.selStart) return;
    fixView();
    const innerHeight = getInnerHeight();
    scroll.scrollNodeVerticallyIntoView(rep, innerHeight);
    if (!doesWrap) {
      const browserSelection = getSelection();
      if (browserSelection) {
        const focusPoint =
            browserSelection.focusAtStart ? browserSelection.startPoint : browserSelection.endPoint;
        const selectionPointX = getSelectionPointX(focusPoint);
        scrollXHorizontallyIntoView(selectionPointX);
        fixView();
      }
    }
  };

  const listAttributeName = 'list';

  const getLineListType = (lineNum) => documentAttributeManager
      .getAttributeOnLine(lineNum, listAttributeName);
  editorInfo.ace_getLineListType = getLineListType;


  const doInsertList = (type) => {
    if (!(rep.selStart && rep.selEnd)) {
      return;
    }

    const firstLine = rep.selStart[0];
    const lastLine = Math.max(firstLine, rep.selEnd[0] - ((rep.selEnd[1] === 0) ? 1 : 0));

    let allLinesAreList = true;
    for (let n = firstLine; n <= lastLine; n++) {
      const listType = getLineListType(n);
      if (!listType || listType.slice(0, type.length) !== type) {
        allLinesAreList = false;
        break;
      }
    }

    const mods = [];
    for (let n = firstLine; n <= lastLine; n++) {
      let level = 0;
      let togglingOn = true;
      const listType = /([a-z]+)([0-9]+)/.exec(getLineListType(n));

      // Used to outdent if ol is removed
      if (allLinesAreList) {
        togglingOn = false;
      }

      if (listType) {
        level = Number(listType[2]);
      }
      const t = getLineListType(n);

      if (t === listType) togglingOn = false;

      if (togglingOn) {
        mods.push([n, allLinesAreList ? `indent${level}` : (t ? type + level : `${type}1`)]);
      } else {
        // scrap the entire indentation and list type
        if (level === 1) { // if outdending but are the first item in the list then outdent
          setLineListType(n, ''); // outdent
        }
        // else change to indented not bullet
        if (level > 1) {
          setLineListType(n, ''); // remove bullet
          setLineListType(n, `indent${level}`); // in/outdent
        }
      }
    }

    for (const mod of mods) setLineListType(mod[0], mod[1]);
  };

  const doInsertUnorderedList = () => {
    doInsertList('bullet');
  };
  const doInsertOrderedList = () => {
    doInsertList('number');
  };
  editorInfo.ace_doInsertUnorderedList = doInsertUnorderedList;
  editorInfo.ace_doInsertOrderedList = doInsertOrderedList;


  // We apply the height of a line in the doc body, to the corresponding sidediv line number
  const updateLineNumbers = () => {
    // Refs #4228, to avoid layout trashing, we need to first calculate all the heights,
    // and then apply at once all new height to div elements
    const lineOffsets = [];

    // To place the line number on the same Z point as the first character of the first line
    // we need to know the line height including the margins of the firstChild within the line
    // This is somewhat computationally expensive as it looks at the first element within
    // the line.  Alternative, cheaper approaches are welcome.
    // Original Issue: https://github.com/ether/etherpad-lite/issues/4527
    const lineHeights = [];

    // 24 is the default line height within Etherpad - There may be quirks here such as
    // none text elements (images/embeds etc) where the line height will be greater
    // but as it's non-text type the line-height/margins might not be present and it
    // could be that this breaks a theme that has a different default line height..
    // So instead of using an integer here we get the value from the Editor CSS.
    const innerdocbodyStyles = getComputedStyle(targetBody);
    const defaultLineHeight = parseInt(innerdocbodyStyles['line-height']);

    for (const docLine of targetBody.children) {
      let h;
      const nextDocLine = docLine.nextElementSibling;
      if (nextDocLine) {
        if (lineOffsets.length === 0) {
          // It's the first line. For line number alignment purposes, its
          // height is taken to be the top offset of the next line. If we
          // didn't do this special case, we would miss out on any top margin
          // included on the first line. The default stylesheet doesn't add
          // extra margins/padding, but plugins might.
          h = nextDocLine.offsetTop - parseInt(
              window.getComputedStyle(targetBody)
                  .getPropertyValue('padding-top').split('px')[0]);
        } else {
          h = nextDocLine.offsetTop - docLine.offsetTop;
        }
      } else {
        // last line
        h = (docLine.clientHeight || docLine.offsetHeight);
      }
      lineOffsets.push(h);

      if (docLine.clientHeight !== defaultLineHeight) {
        // line is wrapped OR has a larger line height within so we will do additional
        // computation to figure out the line-height of the first element and
        // use that for displaying the side div line number inline with the first line
        // of content -- This is used in ep_headings, ep_font_size etc. where the line
        // height is increased.
        const elementStyle = window.getComputedStyle(docLine.firstElementChild);
        const lineHeight = parseInt(elementStyle.getPropertyValue('line-height'));
        const marginBottom = parseInt(elementStyle.getPropertyValue('margin-bottom'));
        lineHeights.push(lineHeight + marginBottom);
      } else {
        lineHeights.push(defaultLineHeight);
      }
    }

    let newNumLines = rep.lines.length();
    if (newNumLines < 1) newNumLines = 1;
    while (sideDivInner.children.length < newNumLines) appendNewSideDivLine();
    while (sideDivInner.children.length > newNumLines) sideDivInner.lastElementChild.remove();
    for (const [i, sideDivLine] of Array.prototype.entries.call(sideDivInner.children)) {
      sideDivLine.style.height = `${lineOffsets[i]}px`;
      sideDivLine.style.lineHeight = `${lineHeights[i]}px`;
    }
  };


  // Init documentAttributeManager
  documentAttributeManager = new AttributeManager(rep, performDocumentApplyChangeset);

  editorInfo.ace_performDocumentApplyAttributesToRange =
      (...args) => documentAttributeManager.setAttributesOnRange(...args);

  this.init = async () => {
    await $.ready;
    inCallStack('setup', () => {
      if (browser.firefox) $(targetBody).addClass('mozilla');
      if (browser.safari) $(targetBody).addClass('safari');
      targetBody.classList.toggle('authorColors', true);
      targetBody.classList.toggle('doesWrap', doesWrap);

      enforceEditability();

      // set up dom and rep
      while (targetBody.firstChild) targetBody.removeChild(targetBody.firstChild);
      const oneEntry = createDomLineEntry('');
      doRepLineSplice(0, rep.lines.length(), [oneEntry]);
      insertDomLines(null, [oneEntry.domInfo]);
      rep.alines = splitAttributionLines(
          makeAttribution('\n'), '\n');

      bindTheEventHandlers();
    });

    hooks.callAll('aceInitialized', {
      editorInfo,
      rep,
      documentAttributeManager,
    });
  };
}

exports.init = async (editorInfo, cssManagers) => {
  const editor = new Ace2Inner(editorInfo, cssManagers);
  await editor.init();
};
