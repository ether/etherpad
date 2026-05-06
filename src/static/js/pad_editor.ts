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

import padutils from "./pad_utils";
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
      // My View
      padutils.bindCheckboxChange($('#options-disablechat'), () => {
        pad.setMyViewOption('showChat', !padutils.getCheckbox($('#options-disablechat')));
      });
      padutils.bindCheckboxChange($('#options-stickychat'), () => {
        pad.setMyViewOption('alwaysShowChat', padutils.getCheckbox($('#options-stickychat')));
      });
      padutils.bindCheckboxChange($('#options-chatandusers'), () => {
        pad.setMyViewOption('chatAndUsers', padutils.getCheckbox($('#options-chatandusers')));
      });
      padutils.bindCheckboxChange($('#options-colorscheck'), () => {
        pad.setMyViewOption('showAuthorColors', padutils.getCheckbox($('#options-colorscheck')));
      });
      padutils.bindCheckboxChange($('#options-fadeauthorcheck'), () => {
        pad.setMyViewOption(
            'fadeInactiveAuthorColors',
            padutils.getCheckbox($('#options-fadeauthorcheck')));
      });
      padutils.bindCheckboxChange($('#options-linenoscheck'), () => {
        pad.setMyViewOption('showLineNumbers', padutils.getCheckbox($('#options-linenoscheck')));
      });
      padutils.bindCheckboxChange($('#options-rtlcheck'), () => {
        pad.setMyViewOption('rtlIsTrue', padutils.getCheckbox($('#options-rtlcheck')));
      });
      $('#viewfontmenu').on('change', () => {
        pad.setMyViewOption('padFontFamily', $('#viewfontmenu').val());
      });
      $('#languagemenu').on('change', () => {
        pad.setMyViewLanguage($('#languagemenu').val());
      });

      // Pad settings
      padutils.bindCheckboxChange($('#padsettings-enforcecheck'), () => {
        pad.changePadOption('enforceSettings', padutils.getCheckbox($('#padsettings-enforcecheck')));
      });
      padutils.bindCheckboxChange($('#padsettings-options-disablechat'), () => {
        pad.changePadOption('showChat', !padutils.getCheckbox($('#padsettings-options-disablechat')));
      });
      padutils.bindCheckboxChange($('#padsettings-options-stickychat'), () => {
        pad.changePadOption(
            'alwaysShowChat', padutils.getCheckbox($('#padsettings-options-stickychat')));
      });
      padutils.bindCheckboxChange($('#padsettings-options-chatandusers'), () => {
        pad.changePadOption(
            'chatAndUsers', padutils.getCheckbox($('#padsettings-options-chatandusers')));
      });
      // Line numbers
      padutils.bindCheckboxChange($('#padsettings-options-linenoscheck'), () => {
        pad.changePadViewOption(
            'showLineNumbers', padutils.getCheckbox($('#padsettings-options-linenoscheck')));
      });

      // Author colors
      padutils.bindCheckboxChange($('#padsettings-options-colorscheck'), () => {
        pad.changePadViewOption(
            'showAuthorColors', padutils.getCheckbox('#padsettings-options-colorscheck'));
      });

      // Fade inactive author colors
      padutils.bindCheckboxChange($('#padsettings-options-fadeauthorcheck'), () => {
        pad.changePadViewOption(
            'fadeInactiveAuthorColors',
            padutils.getCheckbox('#padsettings-options-fadeauthorcheck'));
      });

      // Right to left
      padutils.bindCheckboxChange($('#padsettings-options-rtlcheck'), () => {
        pad.changePadViewOption(
            'rtlIsTrue', padutils.getCheckbox($('#padsettings-options-rtlcheck')));
      });
      html10n.bind('localized', () => {
        $('#languagemenu').val(html10n.getLanguage());
        $('#padsettings-languagemenu').val(html10n.getLanguage());
      });



      // font family change
      $('#padsettings-viewfontmenu').on('change', () => {
        pad.changePadViewOption('padFontFamily', $('#padsettings-viewfontmenu').val());
      });

      padutils.bindCheckboxChange($('#options-darkmode'), () => {
        const isDark = padutils.getCheckbox($('#options-darkmode'));
        skinVariants.setDarkModeInLocalStorage(isDark);
        if (isDark) {
          skinVariants.updateSkinVariantsClasses(
              ['super-dark-editor', 'dark-background', 'super-dark-toolbar']);
        } else {
          skinVariants.updateSkinVariantsClasses(
              ['super-light-toolbar super-light-editor light-background']);
        }
      });

      // delete pad using a recovery token (second device / no creator cookie)
      $('#delete-pad-token-submit').on('click', () => {
        const token = String($('#delete-pad-token-input').val() || '').trim();
        if (!token) return;
        if (!window.confirm(html10n.get('pad.delete.confirm'))) return;

        let handled = false;
        pad.socket.on('message', (data: any) => {
          if (data && data.disconnect === 'deleted') {
            handled = true;
            window.location.href = '/';
          }
        });
        pad.socket.on('shout', (data: any) => {
          handled = true;
          const payload = data?.data?.payload?.message;
          const msg = payload?.messageKey
              ? html10n.get(payload.messageKey)
              : payload?.message;
          if (msg) window.alert(msg);
        });
        pad.collabClient.sendMessage({
          type: 'PAD_DELETE',
          data: {padId: pad.getPadId(), deletionToken: token},
        });
        setTimeout(() => {
          if (!handled) window.location.href = '/';
        }, 5000);
      });

      // delete pad
      $('#delete-pad').on('click', () => {
        if (window.confirm(html10n.get('pad.delete.confirm'))) {
          // Wait for the server to confirm deletion before navigating away.
          // Navigating immediately caused a race condition where the browser
          // (especially Firefox) would close the WebSocket before the delete
          // message reached the server. See #7306.
          let handled = false;
          pad.socket.on('message', (data: any) => {
            if (data && data.disconnect === 'deleted') {
              handled = true;
              window.location.href = '/';
            }
          });
          // If the user is not the pad creator, the server sends a shout
          // message instead of deleting. Listen for it and show the error.
          pad.socket.on('shout', (data: any) => {
            handled = true;
            const payload = data?.data?.payload?.message;
            const msg = payload?.messageKey
                ? html10n.get(payload.messageKey)
                : payload?.message;
            if (msg) window.alert(msg);
          });
          pad.collabClient.sendMessage({type: 'PAD_DELETE', data:{padId: pad.getPadId()}});
          // Fallback: if the server doesn't respond within 5 seconds
          // (e.g. socket dropped), navigate away anyway.
          setTimeout(() => {
            if (!handled) window.location.href = '/';
          }, 5000);
        }
      })

      // Language
      html10n.bind('localized', () => {
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
      $('#padsettings-languagemenu').val(html10n.getLanguage());
      $('#padsettings-languagemenu').on('change', () => {
        pad.changePadOption('lang', $('#padsettings-languagemenu').val());
      });
      if (pad.canEditPadSettings()) {
        $('#pad-settings-section').prop('hidden', false);
        $('.settings-sections').addClass('has-pad-settings');
      }
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

      v = getOption('fadeInactiveAuthorColors', true);
      self.ace.setProperty('fadeInactiveAuthorColors', v);
      padutils.setCheckbox($('#options-fadeauthorcheck'), v);

      // Override from parameters if true
      if (settings.noColors !== false) {
        self.ace.setProperty('showsauthorcolors', !settings.noColors);
      }

      self.ace.setProperty('textface', newOptions.padFontFamily || '');
      $('#viewfontmenu').val(newOptions.padFontFamily || '');
      if ($('select').niceSelect) $('select').niceSelect('update');
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

const getHashedLineNumber = () => {
  const lineNumber = window.location.hash.substr(1);
  if (!lineNumber || lineNumber[0] !== 'L') return null;
  const lineNumberInt = parseInt(lineNumber.substr(1));
  return Number.isInteger(lineNumberInt) && lineNumberInt > 0 ? lineNumberInt : null;
};

const focusOnHashedLine = (ace, lineNumberInt) => {
  const $aceOuter = $('iframe[name="ace_outer"]');
  const $outerdoc = $aceOuter.contents().find('#outerdocbody');
  const $inner = $aceOuter.contents().find('iframe').contents().find('#innerdocbody');
  const line = $inner.find(`div:nth-child(${lineNumberInt})`);
  if (line.length === 0) return false;

  let offsetTop = line.offset().top;
  offsetTop += parseInt($outerdoc.css('padding-top').replace('px', ''));
  const hasMobileLayout = $('body').hasClass('mobile-layout');
  if (!hasMobileLayout) offsetTop += parseInt($inner.css('padding-top').replace('px', ''));
  const $outerdocHTML = $aceOuter.contents().find('#outerdocbody').parent();
  $outerdoc.css({top: `${offsetTop}px`}); // Chrome
  // Direct scrollTop() (was previously $.animate({scrollTop}) for Firefox). The animation
  // workaround is no longer needed because focusOnLine() reapplies the scroll on a settle
  // interval until layout stabilises, which covers Firefox's late-layout behaviour without
  // an animated scroll fighting concurrent layout shifts.
  $outerdocHTML.scrollTop(offsetTop);
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
  return true;
};

exports.focusOnLine = (ace) => {
  const lineNumberInt = getHashedLineNumber();
  if (lineNumberInt == null) return;
  const $aceOuter = $('iframe[name="ace_outer"]');
  const getCurrentTargetOffset = () => {
    const $inner = $aceOuter.contents().find('iframe').contents().find('#innerdocbody');
    const line = $inner.find(`div:nth-child(${lineNumberInt})`);
    if (line.length === 0) return null;
    return line.offset().top;
  };

  // Settle window: keep correcting the scroll position while late content (images,
  // plugin-rendered blocks) shifts the target line's offsetTop. The interval ends when
  // any of the following becomes true:
  //   (a) maxSettleDuration (10s) has elapsed — hard ceiling
  //   (b) the user interacts (see stop() below) — never fight the user
  //   (c) at least minSettleDuration (2s) has elapsed AND the target offset has not
  //       moved by more than offsetEpsilon for stableTicksRequired consecutive ticks
  //       (image loads / plugin renders past the 2s window are still corrected; brief
  //       early stability does not exit the loop prematurely)
  //   (d) the target line is missing from the DOM for missingTicksRequired consecutive
  //       ticks (the anchor doesn't exist — bail rather than spin to maxSettleDuration)
  // Sub-pixel tolerance avoids strict-equality flapping on fractional offsets.
  const maxSettleDuration = 10000;
  const minSettleDuration = 2000;
  const settleInterval = 250;
  const stableTicksRequired = 4;
  const offsetEpsilon = 1;
  const missingTicksRequired = 8; // 2s of consecutive misses → assume invalid anchor
  const startTime = Date.now();
  let intervalId: number | null = null;
  let lastOffset: number | null = null;
  let stableTicks = 0;
  let missingTicks = 0;

  const userEventNames = ['wheel', 'touchmove', 'keydown', 'mousedown'];
  const docs: Document[] = [];
  const stop = () => {
    if (intervalId != null) {
      window.clearInterval(intervalId);
      intervalId = null;
    }
    for (const doc of docs) {
      for (const name of userEventNames) doc.removeEventListener(name, stop, true);
    }
    docs.length = 0;
  };

  const focusUntilStable = () => {
    if (Date.now() - startTime >= maxSettleDuration) {
      stop();
      return;
    }
    const currentOffsetTop = getCurrentTargetOffset();
    if (currentOffsetTop == null) {
      missingTicks += 1;
      if (missingTicks >= missingTicksRequired) stop();
      return;
    }
    missingTicks = 0;
    focusOnHashedLine(ace, lineNumberInt);
    if (lastOffset != null && Math.abs(currentOffsetTop - lastOffset) < offsetEpsilon) {
      stableTicks += 1;
      if (stableTicks >= stableTicksRequired
          && Date.now() - startTime >= minSettleDuration) {
        stop();
      }
    } else {
      stableTicks = 0;
    }
    lastOffset = currentOffsetTop;
  };

  focusUntilStable();
  intervalId = window.setInterval(focusUntilStable, settleInterval);
  // Stop fighting the user: any deliberate scroll, tap, click, or keystroke cancels the
  // reapply loop so late layout corrections do not steal focus once the user takes over.
  // Listen on both the ace_outer and ace_inner documents in capture phase so we see the
  // user's intent even if inner handlers stopPropagation().
  const outerDoc = ($aceOuter.contents()[0] as any) as Document | undefined;
  const innerIframe = $aceOuter.contents().find('iframe')[0] as HTMLIFrameElement | undefined;
  const innerDoc = innerIframe?.contentDocument;
  for (const doc of [outerDoc, innerDoc]) {
    if (!doc) continue;
    docs.push(doc);
    for (const name of userEventNames) doc.addEventListener(name, stop, true);
  }
  // End of setSelection / set Y position of editor
};
