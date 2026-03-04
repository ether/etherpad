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

// These parameters were global, now they are injected. A reference to the
// Timeslider controller would probably be more appropriate.
const _ = require('./underscore');
const padmodals = require('./pad_modals').padmodals;
const colorutils = require('./colorutils').colorutils;
import html10n from './vendors/html10n';

const loadBroadcastSliderJS = (fireWhenAllScriptsAreLoaded) => {
  let BroadcastSlider;

  // Hack to ensure timeslider i18n values are in
  $("[data-key='timeslider_returnToPad'] > a > span").html(
      html10n.get('timeslider.toolbar.returnbutton'));

  (() => { // wrap this code in its own namespace
    let sliderLength = 1000;
    let sliderPos = 0;
    let sliderActive = false;
    const slidercallbacks = [];
    const savedRevisions = [];
    let sliderPlaying = false;

    const _callSliderCallbacks = (newval) => {
      sliderPos = newval;
      for (let i = 0; i < slidercallbacks.length; i++) {
        slidercallbacks[i](newval);
      }
    };

    const updateSliderElements = () => {
      for (let i = 0; i < savedRevisions.length; i++) {
        const position = parseInt(savedRevisions[i].attr('pos'));
        savedRevisions[i].css(
            'left', (position * ($('#ui-slider-bar').width() - 2) / (sliderLength * 1.0)) - 1);
      }
      $('#ui-slider-handle').css(
          'left', sliderPos * ($('#ui-slider-bar').width() - 2) / (sliderLength * 1.0));
    };

    const addSavedRevision = (position, info) => {
      const newSavedRevision = $('<div></div>');
      newSavedRevision.addClass('star');

      newSavedRevision.attr('pos', position);
      newSavedRevision.css(
          'left', (position * ($('#ui-slider-bar').width() - 2) / (sliderLength * 1.0)) - 1);
      $('#ui-slider-bar').append(newSavedRevision);
      newSavedRevision.on('mouseup', (evt) => {
        BroadcastSlider.setSliderPosition(position);
      });
      savedRevisions.push(newSavedRevision);
    };

    /* Begin small 'API' */

    const onSlider = (callback) => {
      slidercallbacks.push(callback);
    };

    const getSliderPosition = () => sliderPos;

    const setSliderPosition = (newpos) => {
      newpos = Number(newpos);
      if (newpos < 0 || newpos > sliderLength) return;
      if (!newpos) {
        newpos = 0; // stops it from displaying NaN if newpos isn't set
      }
      window.location.hash = `#${newpos}`;
      $('#ui-slider-handle').css(
          'left', newpos * ($('#ui-slider-bar').width() - 2) / (sliderLength * 1.0));
      $('a.tlink').map(function () {
        $(this).attr('href', $(this).attr('thref').replace('%revision%', newpos));
      });

      $('#revision_label').html(html10n.get('timeslider.version', {version: newpos}));

      $('#leftstar, #leftstep').toggleClass('disabled', newpos === 0);
      $('#rightstar, #rightstep').toggleClass('disabled', newpos === sliderLength);

      sliderPos = newpos;
      _callSliderCallbacks(newpos);
    };

    const getSliderLength = () => sliderLength;

    const setSliderLength = (newlength) => {
      sliderLength = newlength;
      updateSliderElements();
    };

    // just take over the whole slider screen with a reconnect message

    const showReconnectUI = () => {
      padmodals.showModal('disconnected');
    };

    const setAuthors = (authors) => {
      const authorsList = $('#authorsList');
      authorsList.empty();
      let numAnonymous = 0;
      let numNamed = 0;
      const colorsAnonymous = [];
      _.each(authors, (author) => {
        if (author) {
          const authorColor = clientVars.colorPalette[author.colorId] || author.colorId;
          if (author.name) {
            if (numNamed !== 0) authorsList.append(', ');
            const textColor =
                colorutils.textColorFromBackgroundColor(authorColor, clientVars.skinName);
            $('<span />')
                .text(author.name || 'unnamed')
                .css('background-color', authorColor)
                .css('color', textColor)
                .addClass('author')
                .appendTo(authorsList);

            numNamed++;
          } else {
            numAnonymous++;
            if (authorColor) colorsAnonymous.push(authorColor);
          }
        }
      });
      if (numAnonymous > 0) {
        const anonymousAuthorString = html10n.get('timeslider.unnamedauthors', {num: numAnonymous});

        if (numNamed !== 0) {
          authorsList.append(` + ${anonymousAuthorString}`);
        } else {
          authorsList.append(anonymousAuthorString);
        }

        if (colorsAnonymous.length > 0) {
          authorsList.append(' (');
          _.each(colorsAnonymous, (color, i) => {
            if (i > 0) authorsList.append(' ');
            $('<span>&nbsp;</span>')
                .css('background-color', color)
                .addClass('author author-anonymous')
                .appendTo(authorsList);
          });
          authorsList.append(')');
        }
      }
      if (authors.length === 0) {
        authorsList.append(html10n.get('timeslider.toolbar.authorsList'));
      }
    };

    const playButtonUpdater = () => {
      if (sliderPlaying) {
        if (getSliderPosition() + 1 > sliderLength) {
          $('#playpause_button_icon').toggleClass('pause');
          sliderPlaying = false;
          return;
        }
        setSliderPosition(getSliderPosition() + 1);

        setTimeout(playButtonUpdater, 100);
      }
    };

    const playpause = () => {
      $('#playpause_button_icon').toggleClass('pause');

      if (!sliderPlaying) {
        if (getSliderPosition() === sliderLength) setSliderPosition(0);
        sliderPlaying = true;
        playButtonUpdater();
      } else {
        sliderPlaying = false;
      }
    };

    BroadcastSlider = {
      onSlider,
      getSliderPosition,
      setSliderPosition,
      getSliderLength,
      setSliderLength,
      isSliderActive: () => sliderActive,
      playpause,
      addSavedRevision,
      showReconnectUI,
      setAuthors,
    };

    // assign event handlers to html UI elements after page load
    fireWhenAllScriptsAreLoaded.push(() => {
      $(document).on('keyup', (e) => {
        if (!e) e = window.event;
        const code = e.keyCode || e.which;

        if (code === 37) { // left
          if (e.shiftKey) {
            $('#leftstar').trigger('click');
          } else {
            $('#leftstep').trigger('click');
          }
        } else if (code === 39) { // right
          if (e.shiftKey) {
            $('#rightstar').trigger('click');
          } else {
            $('#rightstep').trigger('click');
          }
        } else if (code === 32) { // spacebar
          $('#playpause_button_icon').trigger('click');
        }
      });

      // Resize
      $(window).on('resize', () => {
        updateSliderElements();
      });

      // Slider click
      $('#ui-slider-bar').on('mousedown', (evt) => {
        $('#ui-slider-handle').css('left', (evt.clientX - $('#ui-slider-bar').offset().left));
        $('#ui-slider-handle').trigger(evt);
      });

      // Slider dragging
      $('#ui-slider-handle').on('mousedown', function (evt) {
        this.startLoc = evt.clientX;
        this.currentLoc = parseInt($(this).css('left'));
        sliderActive = true;
        $(document).on('mousemove', (evt2) => {
          $(this).css('pointer', 'move');
          let newloc = this.currentLoc + (evt2.clientX - this.startLoc);
          if (newloc < 0) newloc = 0;
          const maxPos = $('#ui-slider-bar').width() - 2;
          if (newloc > maxPos) newloc = maxPos;
          const version = Math.floor(newloc * sliderLength / maxPos);
          $('#revision_label').html(html10n.get('timeslider.version', {version}));
          $(this).css('left', newloc);
          if (getSliderPosition() !== version) _callSliderCallbacks(version);
        });
        $(document).on('mouseup', (evt2) => {
          $(document).off('mousemove');
          $(document).off('mouseup');
          sliderActive = false;
          let newloc = this.currentLoc + (evt2.clientX - this.startLoc);
          if (newloc < 0) newloc = 0;
          const maxPos = $('#ui-slider-bar').width() - 2;
          if (newloc > maxPos) newloc = maxPos;
          $(this).css('left', newloc);
          setSliderPosition(Math.floor(newloc * sliderLength / maxPos));
          if (parseInt($(this).css('left')) < 2) {
            $(this).css('left', '2px');
          } else {
            this.currentLoc = parseInt($(this).css('left'));
          }
        });
      });

      // play/pause toggling
      $('#playpause_button_icon').on('click', (evt) => {
        BroadcastSlider.playpause();
      });

      // next/prev saved revision and changeset
      $('.stepper').on('click', function (evt) {
        switch ($(this).attr('id')) {
          case 'leftstep':
            setSliderPosition(getSliderPosition() - 1);
            break;
          case 'rightstep':
            setSliderPosition(getSliderPosition() + 1);
            break;
          case 'leftstar': {
            let nextStar = 0; // default to first revision in document
            for (let i = 0; i < savedRevisions.length; i++) {
              const pos = parseInt(savedRevisions[i].attr('pos'));
              if (pos < getSliderPosition() && nextStar < pos) nextStar = pos;
            }
            setSliderPosition(nextStar);
            break;
          }
          case 'rightstar': {
            let nextStar = sliderLength; // default to last revision in document
            for (let i = 0; i < savedRevisions.length; i++) {
              const pos = parseInt(savedRevisions[i].attr('pos'));
              if (pos > getSliderPosition() && nextStar > pos) nextStar = pos;
            }
            setSliderPosition(nextStar);
            break;
          }
        }
      });

      if (clientVars) {
        $('#timeslider-wrapper').show();

        if (window.location.hash.length > 1) {
          const hashRev = Number(window.location.hash.substr(1));
          if (!isNaN(hashRev)) {
            // this is necessary because of the socket.io-event which loads the changesets
            setTimeout(() => { setSliderPosition(hashRev); }, 1);
          }
        }

        setSliderLength(clientVars.collab_client_vars.rev);
        setSliderPosition(clientVars.collab_client_vars.rev);

        _.each(clientVars.savedRevisions, (revision) => {
          addSavedRevision(revision.revNum, revision);
        });
      }
    });
  })();

  BroadcastSlider.onSlider((loc) => {
    $('#viewlatest').html(
        `${loc === BroadcastSlider.getSliderLength() ? 'Viewing' : 'View'} latest content`);
  });

  return BroadcastSlider;
};

exports.loadBroadcastSliderJS = loadBroadcastSliderJS;
