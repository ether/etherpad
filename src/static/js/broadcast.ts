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

const makeCSSManager = require('./cssmanager').makeCSSManager;
const domline = require('./domline').domline;
import AttribPool from './AttributePool';
import {compose, deserializeOps, inverse, moveOpsToNewPool, mutateAttributionLines, mutateTextLines, splitAttributionLines, splitTextLines, unpack} from './Changeset';
const attributes = require('./attributes');
const linestylefilter = require('./linestylefilter').linestylefilter;
const colorutils = require('./colorutils').colorutils;
const _ = require('./underscore');
const hooks = require('./pluginfw/hooks');

import html10n from './vendors/html10n';


// These parameters were global, now they are injected. A reference to the
// Timeslider controller would probably be more appropriate.
const loadBroadcastJS = (socket, sendSocketMsg, fireWhenAllScriptsAreLoaded, BroadcastSlider) => {
  let goToRevisionIfEnabledCount = 0;
  let changesetLoader = undefined;

  const debugLog = (...args) => {
    try {
      if (window.console) console.log(...args);
    } catch (e) {
      if (window.console) console.log('error printing: ', e);
    }
  };

  const padContents = {
    currentRevision: clientVars.collab_client_vars.rev,
    currentTime: clientVars.collab_client_vars.time,
    currentLines:
        splitTextLines(clientVars.collab_client_vars.initialAttributedText.text),
    currentDivs: null,
    // to be filled in once the dom loads
    apool: (new AttribPool()).fromJsonable(clientVars.collab_client_vars.apool),
    alines: splitAttributionLines(
        clientVars.collab_client_vars.initialAttributedText.attribs,
        clientVars.collab_client_vars.initialAttributedText.text),

    // generates a jquery element containing HTML for a line
    lineToElement(line, aline) {
      const element = document.createElement('div');
      const emptyLine = (line === '\n');
      const domInfo = domline.createDomLine(!emptyLine, true);
      linestylefilter.populateDomLine(line, aline, this.apool, domInfo);
      domInfo.prepareForAdd();
      element.className = domInfo.node.className;
      element.innerHTML = domInfo.node.innerHTML;
      element.id = Math.random();
      return $(element);
    },

    // splice the lines
    splice(start, numRemoved, ...newLines) {
      // remove spliced-out lines from DOM
      for (let i = start; i < start + numRemoved && i < this.currentDivs.length; i++) {
        this.currentDivs[i].remove();
      }

      // remove spliced-out line divs from currentDivs array
      this.currentDivs.splice(start, numRemoved);

      const newDivs = [];
      for (let i = 0; i < newLines.length; i++) {
        newDivs.push(this.lineToElement(newLines[i], this.alines[start + i]));
      }

      // grab the div just before the first one
      let startDiv = this.currentDivs[start - 1] || null;

      // insert the div elements into the correct place, in the correct order
      for (let i = 0; i < newDivs.length; i++) {
        if (startDiv) {
          startDiv.after(newDivs[i]);
        } else {
          $('#innerdocbody').prepend(newDivs[i]);
        }
        startDiv = newDivs[i];
      }

      // insert new divs into currentDivs array
      this.currentDivs.splice(start, 0, ...newDivs);

      // call currentLines.splice, to keep the currentLines array up to date
      this.currentLines.splice(start, numRemoved, ...newLines);
    },
    // returns the contents of the specified line I
    get(i) {
      return this.currentLines[i];
    },
    // returns the number of lines in the document
    length() {
      return this.currentLines.length;
    },

    getActiveAuthors() {
      const authorIds = new Set();
      for (const aline of this.alines) {
        for (const op of deserializeOps(aline)) {
          for (const [k, v] of attributes.attribsFromString(op.attribs, this.apool)) {
            if (k !== 'author') continue;
            if (v) authorIds.add(v);
          }
        }
      }
      return [...authorIds].sort();
    },
  };

  const applyChangeset = (changeset, revision, preventSliderMovement, timeDelta) => {
    // disable the next 'gotorevision' call handled by a timeslider update
    if (!preventSliderMovement) {
      goToRevisionIfEnabledCount++;
      BroadcastSlider.setSliderPosition(revision);
    }

    const oldAlines = padContents.alines.slice();
    try {
      // must mutate attribution lines before text lines
      mutateAttributionLines(changeset, padContents.alines, padContents.apool);
    } catch (e) {
      debugLog(e);
    }

    // scroll to the area that is changed before the lines are mutated
    if ($('#options-followContents').is(':checked') ||
        $('#options-followContents').prop('checked')) {
      // get the index of the first line that has mutated attributes
      // the last line in `oldAlines` should always equal to "|1+1", ie newline without attributes
      // so it should be safe to assume this line has changed attributes when inserting content at
      // the bottom of a pad
      let lineChanged;
      _.some(oldAlines, (line, index) => {
        if (line !== padContents.alines[index]) {
          lineChanged = index;
          return true; // break
        }
      });
      // some chars are replaced (no attributes change and no length change)
      // test if there are keep ops at the start of the cs
      if (lineChanged === undefined) {
        const [op] = deserializeOps(unpack(changeset).ops);
        lineChanged = op != null && op.opcode === '=' ? op.lines : 0;
      }

      const goToLineNumber = (lineNumber) => {
        // Sets the Y scrolling of the browser to go to this line
        const line = $('#innerdocbody').find(`div:nth-child(${lineNumber + 1})`);
        const newY = $(line)[0].offsetTop;
        const ecb = document.getElementById('editorcontainerbox');
        // Chrome 55 - 59 bugfix
        if (ecb.scrollTo) {
          ecb.scrollTo({top: newY, behavior: 'auto'});
        } else {
          $('#editorcontainerbox').scrollTop(newY);
        }
      };

      goToLineNumber(lineChanged);
    }

    mutateTextLines(changeset, padContents);
    padContents.currentRevision = revision;
    padContents.currentTime += timeDelta;

    updateTimer();

    const authors = _.map(padContents.getActiveAuthors(), (name) => authorData[name]);

    BroadcastSlider.setAuthors(authors);
  };

  const loadedNewChangeset = (changesetForward, changesetBackward, revision, timeDelta) => {
    const revisionInfo = window.revisionInfo;
    const broadcasting = (BroadcastSlider.getSliderPosition() === revisionInfo.latest);
    revisionInfo.addChangeset(
        revision, revision + 1, changesetForward, changesetBackward, timeDelta);
    BroadcastSlider.setSliderLength(revisionInfo.latest);
    if (broadcasting) applyChangeset(changesetForward, revision + 1, false, timeDelta);
  };

  /*
   At this point, we must be certain that the changeset really does map from
   the current revision to the specified revision.  Any mistakes here will
   cause the whole slider to get out of sync.
   */

  const updateTimer = () => {
    const zpad = (str, length) => {
      str = `${str}`;
      while (str.length < length) str = `0${str}`;
      return str;
    };

    const date = new Date(padContents.currentTime);
    const dateFormat = () => {
      const month = zpad(date.getMonth() + 1, 2);
      const day = zpad(date.getDate(), 2);
      const year = (date.getFullYear());
      const hours = zpad(date.getHours(), 2);
      const minutes = zpad(date.getMinutes(), 2);
      const seconds = zpad(date.getSeconds(), 2);
      return (html10n.get('timeslider.dateformat', {
        day,
        month,
        year,
        hours,
        minutes,
        seconds,
      }));
    };


    $('#timer').html(dateFormat());
    const revisionDate = html10n.get('timeslider.saved', {
      day: date.getDate(),
      month: [
        html10n.get('timeslider.month.january'),
        html10n.get('timeslider.month.february'),
        html10n.get('timeslider.month.march'),
        html10n.get('timeslider.month.april'),
        html10n.get('timeslider.month.may'),
        html10n.get('timeslider.month.june'),
        html10n.get('timeslider.month.july'),
        html10n.get('timeslider.month.august'),
        html10n.get('timeslider.month.september'),
        html10n.get('timeslider.month.october'),
        html10n.get('timeslider.month.november'),
        html10n.get('timeslider.month.december'),
      ][date.getMonth()],
      year: date.getFullYear(),
    });
    $('#revision_date').html(revisionDate);
  };

  updateTimer();

  const goToRevision = (newRevision) => {
    padContents.targetRevision = newRevision;
    const path = window.revisionInfo.getPath(padContents.currentRevision, newRevision);

    hooks.aCallAll('goToRevisionEvent', {
      rev: newRevision,
    });

    if (path.status === 'complete') {
      const cs = path.changesets;
      let changeset = cs[0];
      let timeDelta = path.times[0];
      for (let i = 1; i < cs.length; i++) {
        changeset = compose(changeset, cs[i], padContents.apool);
        timeDelta += path.times[i];
      }
      if (changeset) applyChangeset(changeset, path.rev, true, timeDelta);
    } else if (path.status === 'partial') {
      // callback is called after changeset information is pulled from server
      // this may never get called, if the changeset has already been loaded
      const update = (start, end) => {
        // if we've called goToRevision in the time since, don't goToRevision
        goToRevision(padContents.targetRevision);
      };

      // do our best with what we have...
      const cs = path.changesets;

      let changeset = cs[0];
      let timeDelta = path.times[0];
      for (let i = 1; i < cs.length; i++) {
        changeset = compose(changeset, cs[i], padContents.apool);
        timeDelta += path.times[i];
      }
      if (changeset) applyChangeset(changeset, path.rev, true, timeDelta);

      // Loading changeset history for new revision
      loadChangesetsForRevision(newRevision, update);
      // Loading changeset history for old revision (to make diff between old and new revision)
      loadChangesetsForRevision(padContents.currentRevision);
    }

    const authors = _.map(padContents.getActiveAuthors(), (name) => authorData[name]);
    BroadcastSlider.setAuthors(authors);
  };

  const loadChangesetsForRevision = (revision, callback) => {
    if (BroadcastSlider.getSliderLength() > 10000) {
      const start = (Math.floor((revision) / 10000) * 10000); // revision 0 to 10
      changesetLoader.queueUp(start, 100);
    }

    if (BroadcastSlider.getSliderLength() > 1000) {
      const start = (Math.floor((revision) / 1000) * 1000); // (start from -1, go to 19) + 1
      changesetLoader.queueUp(start, 10);
    }

    const start = (Math.floor((revision) / 100) * 100);

    changesetLoader.queueUp(start, 1, callback);
  };

  changesetLoader = {
    running: false,
    resolved: [],
    requestQueue1: [],
    requestQueue2: [],
    requestQueue3: [],
    reqCallbacks: [],
    queueUp(revision, width, callback) {
      if (revision < 0) revision = 0;
      // if(this.requestQueue.indexOf(revision) != -1)
      //   return; // already in the queue.
      if (this.resolved.indexOf(`${revision}_${width}`) !== -1) {
        // already loaded from the server
        return;
      }
      this.resolved.push(`${revision}_${width}`);

      const requestQueue =
          width === 1 ? this.requestQueue3
          : width === 10 ? this.requestQueue2
          : this.requestQueue1;
      requestQueue.push(
          {
            rev: revision,
            res: width,
            callback,
          });
      if (!this.running) {
        this.running = true;
        setTimeout(() => this.loadFromQueue(), 10);
      }
    },
    loadFromQueue() {
      const requestQueue =
          this.requestQueue1.length > 0 ? this.requestQueue1
          : this.requestQueue2.length > 0 ? this.requestQueue2
          : this.requestQueue3.length > 0 ? this.requestQueue3
          : null;

      if (!requestQueue) {
        this.running = false;
        return;
      }

      const request = requestQueue.pop();
      const granularity = request.res;
      const callback = request.callback;
      const start = request.rev;
      const requestID = Math.floor(Math.random() * 100000);

      sendSocketMsg('CHANGESET_REQ', {
        start,
        granularity,
        requestID,
      });

      this.reqCallbacks[requestID] = callback;
    },
    handleSocketResponse(message) {
      const start = message.data.start;
      const granularity = message.data.granularity;
      const callback = this.reqCallbacks[message.data.requestID];
      delete this.reqCallbacks[message.data.requestID];

      this.handleResponse(message.data, start, granularity, callback);
      setTimeout(() => this.loadFromQueue(), 10);
    },
    handleResponse: (data, start, granularity, callback) => {
      const pool = (new AttribPool()).fromJsonable(data.apool);
      for (let i = 0; i < data.forwardsChangesets.length; i++) {
        const astart = start + i * granularity - 1; // rev -1 is a blank single line
        let aend = start + (i + 1) * granularity - 1; // totalRevs is the most recent revision
        if (aend > data.actualEndNum - 1) aend = data.actualEndNum - 1;
        // debugLog("adding changeset:", astart, aend);
        const forwardcs =
            moveOpsToNewPool(data.forwardsChangesets[i], pool, padContents.apool);
        const backwardcs =
            moveOpsToNewPool(data.backwardsChangesets[i], pool, padContents.apool);
        window.revisionInfo.addChangeset(astart, aend, forwardcs, backwardcs, data.timeDeltas[i]);
      }
      if (callback) callback(start - 1, start + data.forwardsChangesets.length * granularity - 1);
    },
    handleMessageFromServer(obj) {
      if (obj.type === 'COLLABROOM') {
        obj = obj.data;

        if (obj.type === 'NEW_CHANGES') {
          const changeset = moveOpsToNewPool(
              obj.changeset, (new AttribPool()).fromJsonable(obj.apool), padContents.apool);

          let changesetBack = inverse(
              obj.changeset, padContents.currentLines, padContents.alines, padContents.apool);

          changesetBack = moveOpsToNewPool(
              changesetBack, (new AttribPool()).fromJsonable(obj.apool), padContents.apool);

          loadedNewChangeset(changeset, changesetBack, obj.newRev - 1, obj.timeDelta);
        } else if (obj.type === 'NEW_AUTHORDATA') {
          const authorMap = {};
          authorMap[obj.author] = obj.data;
          receiveAuthorData(authorMap);

          const authors = _.map(padContents.getActiveAuthors(), (name) => authorData[name]);

          BroadcastSlider.setAuthors(authors);
        } else if (obj.type === 'NEW_SAVEDREV') {
          const savedRev = obj.savedRev;
          BroadcastSlider.addSavedRevision(savedRev.revNum, savedRev);
        }
        hooks.callAll(`handleClientTimesliderMessage_${obj.type}`, {payload: obj});
      } else if (obj.type === 'CHANGESET_REQ') {
        this.handleSocketResponse(obj);
      } else {
        debugLog(`Unknown message type: ${obj.type}`);
      }
    },
  };

  // to start upon window load, just push a function onto this array
  // window['onloadFuncts'].push(setUpSocket);
  // window['onloadFuncts'].push(function ()
  fireWhenAllScriptsAreLoaded.push(() => {
    // set up the currentDivs and DOM
    padContents.currentDivs = [];
    $('#innerdocbody').html('');
    for (let i = 0; i < padContents.currentLines.length; i++) {
      const div = padContents.lineToElement(padContents.currentLines[i], padContents.alines[i]);
      padContents.currentDivs.push(div);
      $('#innerdocbody').append(div);
    }
  });

  // this is necessary to keep infinite loops of events firing,
  // since goToRevision changes the slider position
  const goToRevisionIfEnabled = (...args) => {
    if (goToRevisionIfEnabledCount > 0) {
      goToRevisionIfEnabledCount--;
    } else {
      goToRevision(...args);
    }
  };

  BroadcastSlider.onSlider(goToRevisionIfEnabled);

  const dynamicCSS = makeCSSManager(document.querySelector('style[title="dynamicsyntax"]').sheet);
  const authorData = {};

  const receiveAuthorData = (newAuthorData) => {
    for (const [author, data] of Object.entries(newAuthorData)) {
      const bgcolor = typeof data.colorId === 'number'
        ? clientVars.colorPalette[data.colorId] : data.colorId;
      if (bgcolor) {
        const selector = dynamicCSS.selectorStyle(`.${linestylefilter.getAuthorClassName(author)}`);
        selector.backgroundColor = bgcolor;
        selector.color = (colorutils.luminosity(colorutils.css2triple(bgcolor)) < 0.5)
          ? '#ffffff' : '#000000'; // see ace2_inner.js for the other part
      }
      authorData[author] = data;
    }
  };

  receiveAuthorData(clientVars.collab_client_vars.historicalAuthorData);

  return changesetLoader;
};

exports.loadBroadcastJS = loadBroadcastJS;
