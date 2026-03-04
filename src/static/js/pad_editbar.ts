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

const browser = require('./vendors/browser');
const hooks = require('./pluginfw/hooks');
import padutils from "./pad_utils";
const padeditor = require('./pad_editor').padeditor;
const padsavedrevs = require('./pad_savedrevs');
const _ = require('underscore');
require('./vendors/nice-select');

class ToolbarItem {
  constructor(element) {
    this.$el = element;
  }

  getCommand() {
    return this.$el.attr('data-key');
  }

  getValue() {
    if (this.isSelect()) {
      return this.$el.find('select').val();
    }
  }

  setValue(val) {
    if (this.isSelect()) {
      return this.$el.find('select').val(val);
    }
  }

  getType() {
    return this.$el.attr('data-type');
  }

  isSelect() {
    return this.getType() === 'select';
  }

  isButton() {
    return this.getType() === 'button';
  }

  bind(callback) {
    if (this.isButton()) {
      this.$el.on('click', (event) => {
        $(':focus').trigger('blur');
        callback(this.getCommand(), this);
        event.preventDefault();
      });
    } else if (this.isSelect()) {
      this.$el.find('select').on('change', () => {
        callback(this.getCommand(), this);
      });
    }
  }
}

const syncAnimation = (() => {
  const SYNCING = -100;
  const DONE = 100;
  let state = DONE;
  const fps = 25;
  const step = 1 / fps;
  const T_START = -0.5;
  const T_FADE = 1.0;
  const T_GONE = 1.5;
  const animator = padutils.makeAnimationScheduler(() => {
    if (state === SYNCING || state === DONE) {
      return false;
    } else if (state >= T_GONE) {
      state = DONE;
      $('#syncstatussyncing').css('display', 'none');
      $('#syncstatusdone').css('display', 'none');
      return false;
    } else if (state < 0) {
      state += step;
      if (state >= 0) {
        $('#syncstatussyncing').css('display', 'none');
        $('#syncstatusdone').css('display', 'block').css('opacity', 1);
      }
      return true;
    } else {
      state += step;
      if (state >= T_FADE) {
        $('#syncstatusdone').css('opacity', (T_GONE - state) / (T_GONE - T_FADE));
      }
      return true;
    }
  }, step * 1000);
  return {
    syncing: () => {
      state = SYNCING;
      $('#syncstatussyncing').css('display', 'block');
      $('#syncstatusdone').css('display', 'none');
    },
    done: () => {
      state = T_START;
      animator.scheduleAnimation();
    },
  };
})();

exports.padeditbar = new class {
  constructor() {
    this._editbarPosition = 0;
    this.commands = {};
    this.dropdowns = [];
  }

  init() {
    $('#editbar .editbarbutton').attr('unselectable', 'on'); // for IE
    this.enable();
    $('#editbar [data-key]').each((i, elt) => {
      $(elt).off('click');
      new ToolbarItem($(elt)).bind((command, item) => {
        this.triggerCommand(command, item);
      });
    });

    $('body:not(#editorcontainerbox)').on('keydown', (evt) => {
      this._bodyKeyEvent(evt);
    });

    $('.show-more-icon-btn').on('click', () => {
      $('.toolbar').toggleClass('full-icons');
    });
    this.checkAllIconsAreDisplayedInToolbar();
    $(window).on('resize', _.debounce(() => this.checkAllIconsAreDisplayedInToolbar(), 100));

    this._registerDefaultCommands();

    hooks.callAll('postToolbarInit', {
      toolbar: this,
      ace: padeditor.ace,
    });

    /*
     * On safari, the dropdown in the toolbar gets hidden because of toolbar
     * overflow:hidden property. This is a bug from Safari: any children with
     * position:fixed (like the dropdown) should be displayed no matter
     * overflow:hidden on parent
     */
    if (!browser.safari) {
      $('select').niceSelect();
    }

    // When editor is scrolled, we add a class to style the editbar differently
    $('iframe[name="ace_outer"]').contents().on('scroll', (ev) => {
      $('#editbar').toggleClass('editor-scrolled', $(ev.currentTarget).scrollTop() > 2);
    });
  }
  isEnabled() { return true; }
  disable() {
    $('#editbar').addClass('disabledtoolbar').removeClass('enabledtoolbar');
  }
  enable() {
    $('#editbar').addClass('enabledtoolbar').removeClass('disabledtoolbar');
  }
  registerCommand(cmd, callback) {
    this.commands[cmd] = callback;
    return this;
  }
  registerDropdownCommand(cmd, dropdown) {
    dropdown = dropdown || cmd;
    this.dropdowns.push(dropdown);
    this.registerCommand(cmd, () => {
      this.toggleDropDown(dropdown);
    });
  }
  registerAceCommand(cmd, callback) {
    this.registerCommand(cmd, (cmd, ace, item) => {
      ace.callWithAce((ace) => {
        callback(cmd, ace, item);
      }, cmd, true);
    });
  }
  triggerCommand(cmd, item) {
    if (this.isEnabled() && this.commands[cmd]) {
      this.commands[cmd](cmd, padeditor.ace, item);
    }
    if (padeditor.ace) padeditor.ace.focus();
  }

  // cb is deprecated (this function is synchronous so a callback is unnecessary).
  toggleDropDown(moduleName, cb = null) {
    let cbErr = null;
    try {
      // do nothing if users are sticked
      if (moduleName === 'users' && $('#users').hasClass('stickyUsers')) {
        return;
      }

      $('.nice-select').removeClass('open');
      $('.toolbar-popup').removeClass('popup-show');

      // hide all modules and remove highlighting of all buttons
      if (moduleName === 'none') {
        for (const thisModuleName of this.dropdowns) {
          // skip the userlist
          if (thisModuleName === 'users') continue;

          const module = $(`#${thisModuleName}`);

          // skip any "force reconnect" message
          const isAForceReconnectMessage = module.find('button#forcereconnect:visible').length > 0;
          if (isAForceReconnectMessage) continue;
          if (module.hasClass('popup-show')) {
            $(`li[data-key=${thisModuleName}] > a`).removeClass('selected');
            module.removeClass('popup-show');
          }
        }
      } else {
        // hide all modules that are not selected and remove highlighting
        // respectively add highlighting to the corresponding button
        for (const thisModuleName of this.dropdowns) {
          const module = $(`#${thisModuleName}`);

          if (module.hasClass('popup-show')) {
            $(`li[data-key=${thisModuleName}] > a`).removeClass('selected');
            module.removeClass('popup-show');
          } else if (thisModuleName === moduleName) {
            $(`li[data-key=${thisModuleName}] > a`).addClass('selected');
            module.addClass('popup-show');
          }
        }
      }
    } catch (err) {
      cbErr = err || new Error(err);
    } finally {
      if (cb) Promise.resolve().then(() => cb(cbErr));
    }
  }
  setSyncStatus(status) {
    if (status === 'syncing') {
      syncAnimation.syncing();
    } else if (status === 'done') {
      syncAnimation.done();
    }
  }
  setEmbedLinks() {
    const padUrl = window.location.href.split('?')[0];
    const params = '?showControls=true&showChat=true&showLineNumbers=true&useMonospaceFont=false';
    const props = 'width="100%" height="600" frameborder="0"';

    if ($('#readonlyinput').is(':checked')) {
      const urlParts = padUrl.split('/');
      urlParts.pop();
      const readonlyLink = `${urlParts.join('/')}/${clientVars.readOnlyId}`;
      $('#embedinput')
          .val(`<iframe name="embed_readonly" src="${readonlyLink}${params}" ${props}></iframe>`);
      $('#linkinput').val(readonlyLink);
    } else {
      $('#embedinput')
          .val(`<iframe name="embed_readwrite" src="${padUrl}${params}" ${props}></iframe>`);
      $('#linkinput').val(padUrl);
    }
  }
  checkAllIconsAreDisplayedInToolbar() {
    // reset style
    $('.toolbar').removeClass('cropped');
    $('body').removeClass('mobile-layout');
    const menuLeft = $('.toolbar .menu_left')[0];

    // this is approximate, we cannot measure it because on mobile
    // Layout it takes the full width on the bottom of the page
    const menuRightWidth = 280;
    if (menuLeft && menuLeft.scrollWidth > $('.toolbar').width() - menuRightWidth ||
        $('.toolbar').width() < 1000) {
      $('body').addClass('mobile-layout');
    }
    if (menuLeft && menuLeft.scrollWidth > $('.toolbar').width()) {
      $('.toolbar').addClass('cropped');
    }
  }

  _bodyKeyEvent(evt) {
    // If the event is Alt F9 or Escape & we're already in the editbar menu
    // Send the users focus back to the pad
    if ((evt.keyCode === 120 && evt.altKey) || evt.keyCode === 27) {
      if ($(':focus').parents('.toolbar').length === 1) {
        // If we're in the editbar already..
        // Close any dropdowns we have open..
        this.toggleDropDown('none');
        // Shift focus away from any drop downs
        $(':focus').trigger('blur'); // required to do not try to remove!
        // Check we're on a pad and not on the timeslider
        // Or some other window I haven't thought about!
        if (typeof pad === 'undefined') {
          // Timeslider probably..
          $('#editorcontainerbox').trigger('focus'); // Focus back onto the pad
        } else {
          padeditor.ace.focus(); // Sends focus back to pad
          // The above focus doesn't always work in FF, you have to hit enter afterwards
          evt.preventDefault();
        }
      } else {
        // Focus on the editbar :)
        const firstEditbarElement = $('#editbar button').first();

        $(evt.currentTarget).trigger('blur');
        firstEditbarElement.trigger('focus');
        evt.preventDefault();
      }
    }
    // Are we in the toolbar??
    if ($(':focus').parents('.toolbar').length === 1) {
      // On arrow keys go to next/previous button item in editbar
      if (evt.keyCode !== 39 && evt.keyCode !== 37) return;

      // Get all the focusable items in the editbar
      const focusItems = $('#editbar').find('button, select');

      // On left arrow move to next button in editbar
      if (evt.keyCode === 37) {
        // If a dropdown is visible or we're in an input don't move to the next button
        if ($('.popup').is(':visible') || evt.target.localName === 'input') return;

        this._editbarPosition--;
        // Allow focus to shift back to end of row and start of row
        if (this._editbarPosition === -1) this._editbarPosition = focusItems.length - 1;
        $(focusItems[this._editbarPosition]).trigger('focus');
      }

      // On right arrow move to next button in editbar
      if (evt.keyCode === 39) {
        // If a dropdown is visible or we're in an input don't move to the next button
        if ($('.popup').is(':visible') || evt.target.localName === 'input') return;

        this._editbarPosition++;
        // Allow focus to shift back to end of row and start of row
        if (this._editbarPosition >= focusItems.length) this._editbarPosition = 0;
        $(focusItems[this._editbarPosition]).trigger('focus');
      }
    }
  }

  _registerDefaultCommands() {
    this.registerDropdownCommand('showusers', 'users');
    this.registerDropdownCommand('settings');
    this.registerDropdownCommand('connectivity');
    this.registerDropdownCommand('import_export');
    this.registerDropdownCommand('embed');
    this.registerCommand('home', ()=>{
      window.location.href = window.location.href + "/../.."
    })

    this.registerCommand('settings', () => {
      this.toggleDropDown('settings');
      $('#options-stickychat').trigger('focus');
    });

    this.registerCommand('import_export', () => {
      this.toggleDropDown('import_export');
      // If Import file input exists then focus on it..
      if ($('#importfileinput').length !== 0) {
        setTimeout(() => {
          $('#importfileinput').trigger('focus');
        }, 100);
      } else {
        $('.exportlink').first().trigger('focus');
      }
    });

    this.registerCommand('showusers', () => {
      this.toggleDropDown('users');
      $('#myusernameedit').trigger('focus');
    });

    this.registerCommand('embed', () => {
      this.setEmbedLinks();
      this.toggleDropDown('embed');
      $('#linkinput').trigger('focus').trigger('select');
    });

    this.registerCommand('savedRevision', () => {
      padsavedrevs.saveNow();
    });

    this.registerCommand('showTimeSlider', () => {
      document.location = `${document.location.pathname}/timeslider`;
    });

    const aceAttributeCommand = (cmd, ace) => {
      ace.ace_toggleAttributeOnSelection(cmd);
    };
    this.registerAceCommand('bold', aceAttributeCommand);
    this.registerAceCommand('italic', aceAttributeCommand);
    this.registerAceCommand('underline', aceAttributeCommand);
    this.registerAceCommand('strikethrough', aceAttributeCommand);

    this.registerAceCommand('undo', (cmd, ace) => {
      ace.ace_doUndoRedo(cmd);
    });

    this.registerAceCommand('redo', (cmd, ace) => {
      ace.ace_doUndoRedo(cmd);
    });

    this.registerAceCommand('insertunorderedlist', (cmd, ace) => {
      ace.ace_doInsertUnorderedList();
    });

    this.registerAceCommand('insertorderedlist', (cmd, ace) => {
      ace.ace_doInsertOrderedList();
    });

    this.registerAceCommand('indent', (cmd, ace) => {
      if (!ace.ace_doIndentOutdent(false)) {
        ace.ace_doInsertUnorderedList();
      }
    });

    this.registerAceCommand('outdent', (cmd, ace) => {
      ace.ace_doIndentOutdent(true);
    });

    this.registerAceCommand('clearauthorship', (cmd, ace) => {
      // If we have the whole document selected IE control A has been hit
      const rep = ace.ace_getRep();
      let doPrompt = false;
      const lastChar = rep.lines.atIndex(rep.lines.length() - 1).width - 1;
      const lastLineIndex = rep.lines.length() - 1;
      if (rep.selStart[0] === 0 && rep.selStart[1] === 0) {
        // nesting intentionally here to make things readable
        if (rep.selEnd[0] === lastLineIndex && rep.selEnd[1] === lastChar) {
          doPrompt = true;
        }
      }
      /*
       * NOTICE: This command isn't fired on Control Shift C.
       * I intentionally didn't create duplicate code because if you are hitting
       * Control Shift C we make the assumption you are a "power user"
       * and as such we assume you don't need the prompt to bug you each time!
       * This does make wonder if it's worth having a checkbox to avoid being
       * prompted again but that's probably overkill for this contribution.
       */

      // if we don't have any text selected, we have a caret or we have already said to prompt
      if ((!(rep.selStart && rep.selEnd)) || ace.ace_isCaret() || doPrompt) {
        if (window.confirm(html10n.get('pad.editbar.clearcolors'))) {
          ace.ace_performDocumentApplyAttributesToCharRange(0, ace.ace_getRep().alltext.length, [
            ['author', ''],
          ]);
        }
      } else {
        ace.ace_setAttributeOnSelection('author', '');
      }
    });

    this.registerCommand('timeslider_returnToPad', (cmd) => {
      if (document.referrer.length > 0 &&
          document.referrer.substring(document.referrer.lastIndexOf('/') - 1,
              document.referrer.lastIndexOf('/')) === 'p') {
        document.location = document.referrer;
      } else {
        document.location = document.location.href
            .substring(0, document.location.href.lastIndexOf('/'));
      }
    });
  }
}();
