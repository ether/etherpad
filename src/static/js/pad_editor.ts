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

import padutils,{Cookies} from "./pad_utils";
const padcookie = require('./pad_cookie').padcookie;
const Ace2Editor = require('./ace').Ace2Editor;
import html10n from '../js/vendors/html10n'
const skinVariants = require('./skin_variants');

const padeditor = (() => {
  let pad = undefined;
  let settings = undefined;

  const self = {
    ace: null,
    // this is accessed directly from other files
    viewZoom: 100,
    init: async (initialViewOptions, _pad) => {
      pad = _pad;
      settings = pad.settings;
      self.ace = new Ace2Editor();
      await self.ace.init('editorcontainer', '');
      $('#editorloadingbox').hide();
      // Listen for clicks on sidediv items
      const $outerdoc = $('iframe[name="ace_outer"]').contents().find('#outerdocbody');
      $outerdoc.find('#sidedivinner').on('click', 'div', function () {
        const targetLineNumber = $(this).index() + 1;
        window.location.hash = `L${targetLineNumber}`;
      });
      exports.focusOnLine(self.ace);
      self.ace.setProperty('wraps', true);
      self.initViewOptions();
      self.setViewOptions(initialViewOptions);
      // view bar
      $('#viewbarcontents').show();
    },
    initViewOptions: () => {
      // Line numbers
      padutils.bindCheckboxChange($('#options-linenoscheck'), () => {
        pad.changeViewOption('showLineNumbers', padutils.getCheckbox($('#options-linenoscheck')));
      });

      // Author colors
      padutils.bindCheckboxChange($('#options-colorscheck'), () => {
        padcookie.setPref('showAuthorshipColors', padutils.getCheckbox('#options-colorscheck'));
        pad.changeViewOption('showAuthorColors', padutils.getCheckbox('#options-colorscheck'));
      });

      // Right to left
      padutils.bindCheckboxChange($('#options-rtlcheck'), () => {
        pad.changeViewOption('rtlIsTrue', padutils.getCheckbox($('#options-rtlcheck')));
      });
      html10n.bind('localized', () => {
        pad.changeViewOption('rtlIsTrue', ('rtl' === html10n.getDirection()));
        padutils.setCheckbox($('#options-rtlcheck'), ('rtl' === html10n.getDirection()));
      });



      // font family change
      $('#viewfontmenu').on('change', () => {
        pad.changeViewOption('padFontFamily', $('#viewfontmenu').val());
      });

      // delete pad
      $('#delete-pad').on('click', () => {
        if (window.confirm(html10n.get('pad.delete.confirm'))) {
          pad.collabClient.sendMessage({type: 'PAD_DELETE', data:{padId: pad.getPadId()}});
          // redirect to home page after deletion
          window.location.href = '/';
        }
      })

      // theme switch
      $('#theme-switcher').on('click',()=>{
          if (skinVariants.isDarkMode()) {
            skinVariants.setDarkModeInLocalStorage(false);
            skinVariants.updateSkinVariantsClasses(['super-light-toolbar super-light-editor light-background']);
          } else {
            skinVariants.setDarkModeInLocalStorage(true);
            skinVariants.updateSkinVariantsClasses(['super-dark-editor', 'dark-background', 'super-dark-toolbar']);
          }
      })

      // Language
      html10n.bind('localized', () => {
        $('#languagemenu').val(html10n.getLanguage());
        // translate the value of 'unnamed' and 'Enter your name' textboxes in the userlist

        // this does not interfere with html10n's normal value-setting because
        // html10n just ingores <input>s
        // also, a value which has been set by the user will be not overwritten
        // since a user-edited <input> does *not* have the editempty-class
        $('input[data-l10n-id]').each((key, input) => {
          input = $(input);
          if (input.hasClass('editempty')) {
            input.val(html10n.get(input.attr('data-l10n-id')));
          }
        });
      });
      $('#languagemenu').val(html10n.getLanguage());
      $('#languagemenu').on('change', () => {
        Cookies.set('language', $('#languagemenu').val());
        html10n.localize([$('#languagemenu').val(), 'en']);
        if ($('select').niceSelect) {
          $('select').niceSelect('update');
        }
      });
    },
    setViewOptions: (newOptions) => {
      const getOption = (key, defaultValue) => {
        const value = String(newOptions[key]);
        if (value === 'true') return true;
        if (value === 'false') return false;
        return defaultValue;
      };

      let v;

      v = getOption('rtlIsTrue', ('rtl' === html10n.getDirection()));
      self.ace.setProperty('rtlIsTrue', v);
      padutils.setCheckbox($('#options-rtlcheck'), v);

      v = getOption('showLineNumbers', true);
      self.ace.setProperty('showslinenumbers', v);
      padutils.setCheckbox($('#options-linenoscheck'), v);

      v = getOption('showAuthorColors', true);
      self.ace.setProperty('showsauthorcolors', v);
      $('#chattext').toggleClass('authorColors', v);
      $('iframe[name="ace_outer"]').contents().find('#sidedivinner').toggleClass('authorColors', v);
      padutils.setCheckbox($('#options-colorscheck'), v);

      // Override from parameters if true
      if (settings.noColors !== false) {
        self.ace.setProperty('showsauthorcolors', !settings.noColors);
      }

      self.ace.setProperty('textface', newOptions.padFontFamily || '');
    },
    dispose: () => {
      if (self.ace) {
        self.ace.destroy();
        self.ace = null;
      }
    },
    enable: () => {
      if (self.ace) {
        self.ace.setEditable(true);
      }
    },
    disable: () => {
      if (self.ace) {
        self.ace.setEditable(false);
      }
    },
    restoreRevisionText: (dataFromServer) => {
      pad.addHistoricalAuthors(dataFromServer.historicalAuthorData);
      self.ace.importAText(dataFromServer.atext, dataFromServer.apool, true);
    },
  };
  return self;
})();

exports.padeditor = padeditor;

exports.focusOnLine = (ace) => {
  // If a number is in the URI IE #L124 go to that line number
  const lineNumber = window.location.hash.substr(1);
  if (lineNumber) {
    if (lineNumber[0] === 'L') {
      const $outerdoc = $('iframe[name="ace_outer"]').contents().find('#outerdocbody');
      const lineNumberInt = parseInt(lineNumber.substr(1));
      if (lineNumberInt) {
        const $inner = $('iframe[name="ace_outer"]').contents().find('iframe')
            .contents().find('#innerdocbody');
        const line = $inner.find(`div:nth-child(${lineNumberInt})`);
        if (line.length !== 0) {
          let offsetTop = line.offset().top;
          offsetTop += parseInt($outerdoc.css('padding-top').replace('px', ''));
          const hasMobileLayout = $('body').hasClass('mobile-layout');
          if (!hasMobileLayout) {
            offsetTop += parseInt($inner.css('padding-top').replace('px', ''));
          }
          const $outerdocHTML = $('iframe[name="ace_outer"]').contents()
              .find('#outerdocbody').parent();
          $outerdoc.css({top: `${offsetTop}px`}); // Chrome
          $outerdocHTML.animate({scrollTop: offsetTop}); // needed for FF
          const node = line[0];
          ace.callWithAce((ace) => {
            const selection = {
              startPoint: {
                index: 0,
                focusAtStart: true,
                maxIndex: 1,
                node,
              },
              endPoint: {
                index: 0,
                focusAtStart: true,
                maxIndex: 1,
                node,
              },
            };
            ace.ace_setSelection(selection);
          });
        }
      }
    }
  }
  // End of setSelection / set Y position of editor
};
