// @ts-nocheck
'use strict';

/**
 * This code is mostly from the old Etherpad. Please help us to comment this code.
 * This helps other people to understand this code better and helps them to improve it.
 * TL;DR COMMENTS ON THIS FILE ARE HIGHLY APPRECIATED
 */

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

import {characterRangeFollow, compose, follow, isIdentity, unpack} from './Changeset';
const _ = require('./underscore');

const undoModule = (() => {
  const stack = (() => {
    const stackElements = [];
    // two types of stackElements:
    // 1) { elementType: UNDOABLE_EVENT, eventType: "anything", [backset: <changeset>,]
    //      [selStart: <char number>, selEnd: <char number>, selFocusAtStart: <boolean>] }
    // 2) { elementType: EXTERNAL_CHANGE, changeset: <changeset> }
    // invariant: no two consecutive EXTERNAL_CHANGEs
    let numUndoableEvents = 0;

    const UNDOABLE_EVENT = 'undoableEvent';
    const EXTERNAL_CHANGE = 'externalChange';

    const clearStack = () => {
      stackElements.length = 0;
      stackElements.push(
          {
            elementType: UNDOABLE_EVENT,
            eventType: 'bottom',
          });
      numUndoableEvents = 1;
    };
    clearStack();

    const pushEvent = (event) => {
      const e = _.extend(
          {}, event);
      e.elementType = UNDOABLE_EVENT;
      stackElements.push(e);
      numUndoableEvents++;
    };

    const pushExternalChange = (cs) => {
      const idx = stackElements.length - 1;
      if (stackElements[idx].elementType === EXTERNAL_CHANGE) {
        stackElements[idx].changeset =
            compose(stackElements[idx].changeset, cs, getAPool());
      } else {
        stackElements.push(
            {
              elementType: EXTERNAL_CHANGE,
              changeset: cs,
            });
      }
    };

    const _exposeEvent = (nthFromTop) => {
      // precond: 0 <= nthFromTop < numUndoableEvents
      const targetIndex = stackElements.length - 1 - nthFromTop;
      let idx = stackElements.length - 1;
      while (idx > targetIndex || stackElements[idx].elementType === EXTERNAL_CHANGE) {
        if (stackElements[idx].elementType === EXTERNAL_CHANGE) {
          const ex = stackElements[idx];
          const un = stackElements[idx - 1];
          if (un.backset) {
            const excs = ex.changeset;
            const unbs = un.backset;
            un.backset = follow(excs, un.backset, false, getAPool());
            ex.changeset = follow(unbs, ex.changeset, true, getAPool());
            if ((typeof un.selStart) === 'number') {
              const newSel = characterRangeFollow(excs, un.selStart, un.selEnd);
              un.selStart = newSel[0];
              un.selEnd = newSel[1];
              if (un.selStart === un.selEnd) {
                un.selFocusAtStart = false;
              }
            }
          }
          stackElements[idx - 1] = ex;
          stackElements[idx] = un;
          if (idx >= 2 && stackElements[idx - 2].elementType === EXTERNAL_CHANGE) {
            ex.changeset =
                compose(stackElements[idx - 2].changeset, ex.changeset, getAPool());
            stackElements.splice(idx - 2, 1);
            idx--;
          }
        } else {
          idx--;
        }
      }
    };

    const getNthFromTop = (n) => {
      // precond: 0 <= n < numEvents()
      _exposeEvent(n);
      return stackElements[stackElements.length - 1 - n];
    };

    const numEvents = () => numUndoableEvents;

    const popEvent = () => {
      // precond: numEvents() > 0
      _exposeEvent(0);
      numUndoableEvents--;
      return stackElements.pop();
    };

    return {
      numEvents,
      popEvent,
      pushEvent,
      pushExternalChange,
      clearStack,
      getNthFromTop,
    };
  })();

  // invariant: stack always has at least one undoable event
  let undoPtr = 0; // zero-index from top of stack, 0 == top

  const clearHistory = () => {
    stack.clearStack();
    undoPtr = 0;
  };

  const _charOccurrences = (str, c) => {
    let i = 0;
    let count = 0;
    while (i >= 0 && i < str.length) {
      i = str.indexOf(c, i);
      if (i >= 0) {
        count++;
        i++;
      }
    }
    return count;
  };

  const _opcodeOccurrences = (cs, opcode) => _charOccurrences(unpack(cs).ops, opcode);

  const _mergeChangesets = (cs1, cs2) => {
    if (!cs1) return cs2;
    if (!cs2) return cs1;

    // Rough heuristic for whether changesets should be considered one action:
    // each does exactly one insertion, no dels, and the composition does also; or
    // each does exactly one deletion, no ins, and the composition does also.
    // A little weird in that it won't merge "make bold" with "insert char"
    // but will merge "make bold and insert char" with "insert char",
    // though that isn't expected to come up.
    const plusCount1 = _opcodeOccurrences(cs1, '+');
    const plusCount2 = _opcodeOccurrences(cs2, '+');
    const minusCount1 = _opcodeOccurrences(cs1, '-');
    const minusCount2 = _opcodeOccurrences(cs2, '-');
    if (plusCount1 === 1 && plusCount2 === 1 && minusCount1 === 0 && minusCount2 === 0) {
      const merge = compose(cs1, cs2, getAPool()!);
      const plusCount3 = _opcodeOccurrences(merge, '+');
      const minusCount3 = _opcodeOccurrences(merge, '-');
      if (plusCount3 === 1 && minusCount3 === 0) {
        return merge;
      }
    } else if (plusCount1 === 0 && plusCount2 === 0 && minusCount1 === 1 && minusCount2 === 1) {
      const merge = compose(cs1, cs2, getAPool()!);
      const plusCount3 = _opcodeOccurrences(merge, '+');
      const minusCount3 = _opcodeOccurrences(merge, '-');
      if (plusCount3 === 0 && minusCount3 === 1) {
        return merge;
      }
    }
    return null;
  };

  const reportEvent = (event) => {
    const topEvent = stack.getNthFromTop(0);

    const applySelectionToTop = () => {
      if ((typeof event.selStart) === 'number') {
        topEvent.selStart = event.selStart;
        topEvent.selEnd = event.selEnd;
        topEvent.selFocusAtStart = event.selFocusAtStart;
      }
    };

    if ((!event.backset) || isIdentity(event.backset)) {
      applySelectionToTop();
    } else {
      let merged = false;
      if (topEvent.eventType === event.eventType) {
        const merge = _mergeChangesets(event.backset, topEvent.backset);
        if (merge) {
          topEvent.backset = merge;
          applySelectionToTop();
          merged = true;
        }
      }
      if (!merged) {
        /*
         * Push the event on the undo stack only if it exists, and if it's
         * not a "clearauthorship". This disallows undoing the removal of the
         * authorship colors, but is a necessary stopgap measure against
         * https://github.com/ether/etherpad-lite/issues/2802
         */
        if (event && (event.eventType !== 'clearauthorship')) {
          stack.pushEvent(event);
        }
      }
      undoPtr = 0;
    }
  };

  const reportExternalChange = (changeset) => {
    if (changeset && !isIdentity(changeset)) {
      stack.pushExternalChange(changeset);
    }
  };

  const _getSelectionInfo = (event) => {
    if ((typeof event.selStart) !== 'number') {
      return null;
    } else {
      return {
        selStart: event.selStart,
        selEnd: event.selEnd,
        selFocusAtStart: event.selFocusAtStart,
      };
    }
  };

  // For "undo" and "redo", the change event must be returned
  // by eventFunc and NOT reported through the normal mechanism.
  // "eventFunc" should take a changeset and an optional selection info object,
  // or can be called with no arguments to mean that no undo is possible.
  // "eventFunc" will be called exactly once.

  const performUndo = (eventFunc) => {
    if (undoPtr < stack.numEvents() - 1) {
      const backsetEvent = stack.getNthFromTop(undoPtr);
      const selectionEvent = stack.getNthFromTop(undoPtr + 1);
      const undoEvent = eventFunc(backsetEvent.backset, _getSelectionInfo(selectionEvent));
      stack.pushEvent(undoEvent);
      undoPtr += 2;
    } else { eventFunc(); }
  };

  const performRedo = (eventFunc) => {
    if (undoPtr >= 2) {
      const backsetEvent = stack.getNthFromTop(0);
      const selectionEvent = stack.getNthFromTop(1);
      eventFunc(backsetEvent.backset, _getSelectionInfo(selectionEvent));
      stack.popEvent();
      undoPtr -= 2;
    } else { eventFunc(); }
  };

  const getAPool = () => undoModule.apool;

  return {
    clearHistory,
    reportEvent,
    reportExternalChange,
    performUndo,
    performRedo,
    enabled: true,
    apool: null,
  }; // apool is filled in by caller
})();

exports.undoModule = undoModule;
