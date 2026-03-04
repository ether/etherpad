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

import AttributeMap from './AttributeMap';
import AttributePool from './AttributePool';
import {applyToAText, checkRep, cloneAText, compose, deserializeOps, follow, identity, isIdentity, makeAText, moveOpsToNewPool, newLen, pack, prepareForWire, unpack} from './Changeset';
import {MergingOpAssembler} from "./MergingOpAssembler";

const makeChangesetTracker = (scheduler, apool, aceCallbacksProvider) => {
  // latest official text from server
  let baseAText = makeAText('\n');
  // changes applied to baseText that have been submitted
  let submittedChangeset = null;
  // changes applied to submittedChangeset since it was prepared
  let userChangeset = identity(1);
  // is the changesetTracker enabled
  let tracking = false;
  // stack state flag so that when we change the rep we don't
  // handle the notification recursively.  When setting, always
  // unset in a "finally" block.  When set to true, the setter
  // takes change of userChangeset.
  let applyingNonUserChanges = false;

  let changeCallback = null;

  let changeCallbackTimeout = null;

  const setChangeCallbackTimeout = () => {
    // can call this multiple times per call-stack, because
    // we only schedule a call to changeCallback if it exists
    // and if there isn't a timeout already scheduled.
    if (changeCallback && changeCallbackTimeout == null) {
      changeCallbackTimeout = scheduler.setTimeout(() => {
        try {
          changeCallback();
        } catch (pseudoError) {
          // as empty as my soul
        } finally {
          changeCallbackTimeout = null;
        }
      }, 0);
    }
  };

  let self;
  return self = {
    isTracking: () => tracking,
    setBaseText: (text) => {
      self.setBaseAttributedText(makeAText(text), null);
    },
    setBaseAttributedText: (atext, apoolJsonObj) => {
      aceCallbacksProvider.withCallbacks('setBaseText', (callbacks) => {
        tracking = true;
        baseAText = cloneAText(atext);
        if (apoolJsonObj) {
          const wireApool = (new AttributePool()).fromJsonable(apoolJsonObj);
          baseAText.attribs = moveOpsToNewPool(baseAText.attribs, wireApool, apool);
        }
        submittedChangeset = null;
        userChangeset = identity(atext.text.length);
        applyingNonUserChanges = true;
        try {
          callbacks.setDocumentAttributedText(atext);
        } finally {
          applyingNonUserChanges = false;
        }
      });
    },
    composeUserChangeset: (c) => {
      if (!tracking) return;
      if (applyingNonUserChanges) return;
      if (isIdentity(c)) return;
      userChangeset = compose(userChangeset, c, apool);

      setChangeCallbackTimeout();
    },
    applyChangesToBase: (c, optAuthor, apoolJsonObj) => {
      if (!tracking) return;

      aceCallbacksProvider.withCallbacks('applyChangesToBase', (callbacks) => {
        if (apoolJsonObj) {
          const wireApool = (new AttributePool()).fromJsonable(apoolJsonObj);
          c = moveOpsToNewPool(c, wireApool, apool);
        }

        baseAText = applyToAText(c, baseAText, apool);

        let c2 = c;
        if (submittedChangeset) {
          const oldSubmittedChangeset = submittedChangeset;
          submittedChangeset = follow(c, oldSubmittedChangeset, false, apool);
          c2 = follow(oldSubmittedChangeset, c, true, apool);
        }

        const preferInsertingAfterUserChanges = true;
        const oldUserChangeset = userChangeset;
        userChangeset = follow(
            c2, oldUserChangeset, preferInsertingAfterUserChanges, apool);
        const postChange = follow(
            oldUserChangeset, c2, !preferInsertingAfterUserChanges, apool);

        const preferInsertionAfterCaret = true; // (optAuthor && optAuthor > thisAuthor);
        applyingNonUserChanges = true;
        try {
          callbacks.applyChangesetToDocument(postChange, preferInsertionAfterCaret);
        } finally {
          applyingNonUserChanges = false;
        }
      });
    },
    prepareUserChangeset: () => {
      // If there are user changes to submit, 'changeset' will be the
      // changeset, else it will be null.
      let toSubmit;
      if (submittedChangeset) {
        // submission must have been canceled, prepare new changeset
        // that includes old submittedChangeset
        toSubmit = compose(submittedChangeset, userChangeset, apool);
      } else {
        // Get my authorID
        const authorId = window.pad.myUserInfo.userId;

        // Sanitize authorship: Replace all author attributes with this user's author ID in case the
        // text was copied from another author.
        const cs = unpack(userChangeset);
        const assem = new MergingOpAssembler();

        for (const op of deserializeOps(cs.ops)) {
          if (op.opcode === '+') {
            const attribs = AttributeMap.fromString(op.attribs, apool);
            const oldAuthorId = attribs.get('author');
            if (oldAuthorId != null && oldAuthorId !== authorId) {
              attribs.set('author', authorId);
              op.attribs = attribs.toString();
            }
          }
          assem.append(op);
        }
        assem.endDocument();
        userChangeset = pack(cs.oldLen, cs.newLen, assem.toString(), cs.charBank);
        checkRep(userChangeset);

        if (isIdentity(userChangeset)) toSubmit = null;
        else toSubmit = userChangeset;
      }

      let cs = null;
      if (toSubmit) {
        submittedChangeset = toSubmit;
        userChangeset = identity(newLen(toSubmit));

        cs = toSubmit;
      }
      let wireApool = null;
      if (cs) {
        const forWire = prepareForWire(cs, apool);
        wireApool = forWire.pool.toJsonable();
        cs = forWire.translated;
      }

      const data = {
        changeset: cs,
        apool: wireApool,
      };
      return data;
    },
    applyPreparedChangesetToBase: () => {
      if (!submittedChangeset) {
        // violation of protocol; use prepareUserChangeset first
        throw new Error('applySubmittedChangesToBase: no submitted changes to apply');
      }
      // bumpDebug("applying committed changeset: "+submittedChangeset.encodeToString(false));
      baseAText = applyToAText(submittedChangeset, baseAText, apool);
      submittedChangeset = null;
    },
    setUserChangeNotificationCallback: (callback) => {
      changeCallback = callback;
    },
    hasUncommittedChanges: () => !!(submittedChangeset || (!isIdentity(userChangeset))),
  };
};

exports.makeChangesetTracker = makeChangesetTracker;
