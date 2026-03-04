// @ts-nocheck
'use strict';
/**
 * Copyright 2009 Google Inc., 2011 Peter 'Pita' Martischka (Primary Technology Ltd)
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

import ChatMessage from './ChatMessage';
import padutils from './pad_utils'
const padcookie = require('./pad_cookie').padcookie;
const Tinycon = require('tinycon/tinycon');
const hooks = require('./pluginfw/hooks');
const padeditor = require('./pad_editor').padeditor;
import html10n from './vendors/html10n';

// Removes diacritics and lower-cases letters. https://stackoverflow.com/a/37511463
const normalize = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();


exports.chat = (() => {
  let isStuck = false;
  let userAndChat = false;
  let chatMentions = 0;
  return {
    show() {
      $('#chaticon').removeClass('visible');
      $('#chatbox').addClass('visible');
      this.scrollDown(true);
      chatMentions = 0;
      Tinycon.setBubble(0);
      $('.chat-gritter-msg').each(function () {
        $.gritter.remove(this.id);
      });
    },
    focus: () => {
      setTimeout(() => {
        $('#chatinput').trigger('focus');
      }, 100);
    },
    // Make chat stick to right hand side of screen
    stickToScreen(fromInitialCall) {
      if ($('#options-stickychat').prop('checked')) {
        $('#options-stickychat').prop('checked', false);
      }
      if (pad.settings.hideChat) {
        return;
      }
      this.show();
      isStuck = (!isStuck || fromInitialCall);
      $('#chatbox').hide();
      // Add timeout to disable the chatbox animations
      setTimeout(() => {
        $('#chatbox, .sticky-container').toggleClass('stickyChat', isStuck);
        $('#chatbox').css('display', 'flex');
      }, 0);

      padcookie.setPref('chatAlwaysVisible', isStuck);
      $('#options-stickychat').prop('checked', isStuck);
    },
    chatAndUsers(fromInitialCall) {
      const toEnable = $('#options-chatandusers').is(':checked');
      if (toEnable || !userAndChat || fromInitialCall) {
        this.stickToScreen(true);
        $('#options-stickychat').prop('checked', true);
        $('#options-chatandusers').prop('checked', true);
        $('#options-stickychat').prop('disabled', true);
        userAndChat = true;
      } else {
        $('#options-stickychat').prop('disabled', false);
        userAndChat = false;
      }
      padcookie.setPref('chatAndUsers', userAndChat);
      $('#users, .sticky-container')
          .toggleClass('chatAndUsers popup-show stickyUsers', userAndChat);
      $('#chatbox').toggleClass('chatAndUsersChat', userAndChat);
    },
    hide() {
      // decide on hide logic based on chat window being maximized or not
      if ($('#options-stickychat').prop('checked')) {
        this.stickToScreen();
        $('#options-stickychat').prop('checked', false);
      } else {
        $('#chatcounter').text('0');
        $('#chaticon').addClass('visible');
        $('#chatbox').removeClass('visible');
      }
    },
    scrollDown(force) {
      if ($('#chatbox').hasClass('visible')) {
        if (force || !this.lastMessage || !this.lastMessage.position() ||
            this.lastMessage.position().top < ($('#chattext').outerHeight() + 20)) {
          // if we use a slow animate here we can have a race condition
          // when a users focus can not be moved away from the last message recieved.
          $('#chattext').animate(
              {scrollTop: $('#chattext')[0].scrollHeight},
              {duration: 400, queue: false});
          this.lastMessage = $('#chattext > p').eq(-1);
        }
      }
    },
    async send() {
      const text = $('#chatinput').val();
      if (text.replace(/\s+/, '').length === 0) return;
      const message = new ChatMessage(text);
      await hooks.aCallAll('chatSendMessage', Object.freeze({message}));
      this._pad.collabClient.sendMessage({type: 'CHAT_MESSAGE', message});
      $('#chatinput').val('');
    },
    async addMessage(msg, increment, isHistoryAdd) {
      msg = ChatMessage.fromObject(msg);
      // correct the time
      msg.time += this._pad.clientTimeOffset;

      if (!msg.authorId) {
        /*
         * If, for a bug or a database corruption, the message coming from the
         * server does not contain the authorId field (see for example #3731),
         * let's be defensive and replace it with "unknown".
         */
        msg.authorId = 'unknown';
        console.warn(
            'The "authorId" field of a chat message coming from the server was not present. ' +
            'Replacing with "unknown". This may be a bug or a database corruption.');
      }

      const authorClass = (authorId) => `author-${authorId.replace(/[^a-y0-9]/g, (c) => {
        if (c === '.') return '-';
        return `z${c.charCodeAt(0)}z`;
      })}`;

      // the hook args
      const ctx = {
        authorName: msg.displayName != null ? msg.displayName : html10n.get('pad.userlist.unnamed'),
        author: msg.authorId,
        text: padutils.escapeHtmlWithClickableLinks(msg.text, '_blank'),
        message: msg,
        rendered: null,
        sticky: false,
        timestamp: msg.time,
        timeStr: (() => {
          let minutes = `${new Date(msg.time).getMinutes()}`;
          let hours = `${new Date(msg.time).getHours()}`;
          if (minutes.length === 1) minutes = `0${minutes}`;
          if (hours.length === 1) hours = `0${hours}`;
          return `${hours}:${minutes}`;
        })(),
        duration: 4000,
      };

      // is the users focus already in the chatbox?
      const alreadyFocused = $('#chatinput').is(':focus');

      // does the user already have the chatbox open?
      const chatOpen = $('#chatbox').hasClass('visible');

      // does this message contain this user's name? (is the current user mentioned?)
      const wasMentioned =
          msg.authorId !== window.clientVars.userId &&
          ctx.authorName !== html10n.get('pad.userlist.unnamed') &&
          normalize(ctx.text).includes(normalize(ctx.authorName));

      // If the user was mentioned, make the message sticky
      if (wasMentioned && !alreadyFocused && !isHistoryAdd && !chatOpen) {
        chatMentions++;
        Tinycon.setBubble(chatMentions);
        ctx.sticky = true;
      }

      await hooks.aCallAll('chatNewMessage', ctx);
      const cls = authorClass(ctx.author);
      const chatMsg = ctx.rendered != null ? $(ctx.rendered) : $('<p>')
          .attr('data-authorId', ctx.author)
          .addClass(cls)
          .append($('<b>').text(`${ctx.authorName}:`))
          .append($('<span>')
              .addClass('time')
              .addClass(cls)
              // Hook functions are trusted to not introduce an XSS vulnerability by adding
              // unescaped user input to ctx.timeStr.
              .html(ctx.timeStr))
          .append(' ')
          // ctx.text was HTML-escaped before calling the hook. Hook functions are trusted to not
          // introduce an XSS vulnerability by adding unescaped user input.
          .append($('<div>').html(ctx.text).contents());
      if (isHistoryAdd) chatMsg.insertAfter('#chatloadmessagesbutton');
      else $('#chattext').append(chatMsg);
      chatMsg.each((i, e) => html10n.translateElement(html10n.translations, e));

      // should we increment the counter??
      if (increment && !isHistoryAdd) {
        // Update the counter of unread messages
        let count = Number($('#chatcounter').text());
        count++;
        $('#chatcounter').text(count);

        if (!chatOpen && ctx.duration > 0) {
          const text = $('<p>')
              .append($('<span>').addClass('author-name').text(ctx.authorName))
              // ctx.text was HTML-escaped before calling the hook. Hook functions are trusted
              // to not introduce an XSS vulnerability by adding unescaped user input.
              .append($('<div>').html(ctx.text).contents());
          text.each((i, e) => html10n.translateElement(html10n.translations, e));
          $.gritter.add({
            text,
            sticky: ctx.sticky,
            time: ctx.duration,
            position: 'bottom',
            class_name: 'chat-gritter-msg',
          });
        }
      }
      if (!isHistoryAdd) this.scrollDown();
    },
    init(pad) {
      this._pad = pad;
      $('#chatinput').on('keydown', (evt) => {
        // If the event is Alt C or Escape & we're already in the chat menu
        // Send the users focus back to the pad
        if ((evt.altKey === true && evt.which === 67) || evt.which === 27) {
          // If we're in chat already..
          $(':focus').trigger('blur'); // required to do not try to remove!
          padeditor.ace.focus(); // Sends focus back to pad
          evt.preventDefault();
          return false;
        }
      });
      // Clear the chat mentions when the user clicks on the chat input box
      $('#chatinput').on('click', () => {
        chatMentions = 0;
        Tinycon.setBubble(0);
      });

      const self = this;
      $('body:not(#chatinput)').on('keypress', function (evt) {
        if (evt.altKey && evt.which === 67) {
          // Alt c focuses on the Chat window
          $(this).trigger('blur');
          self.show();
          $('#chatinput').trigger('focus');
          evt.preventDefault();
        }
      });

      $('#chatinput').on('keypress', (evt) => {
        // if the user typed enter, fire the send
        if (evt.key === 'Enter' && !evt.shiftKey) {
          evt.preventDefault();
          this.send();
        }
      });

      // initial messages are loaded in pad.js' _afterHandshake

      $('#chatcounter').text(0);
      $('#chatloadmessagesbutton').on('click', () => {
        const start = Math.max(this.historyPointer - 20, 0);
        const end = this.historyPointer;

        if (start === end) return; // nothing to load

        $('#chatloadmessagesbutton').css('display', 'none');
        $('#chatloadmessagesball').css('display', 'block');

        pad.collabClient.sendMessage({type: 'GET_CHAT_MESSAGES', start, end});
        this.historyPointer = start;
      });
    },
  };
})();
