'use strict';

const helper = {};

(() => {
  let $iframe;

  helper.randomString = (len) => {
    const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    let randomstring = '';
    for (let i = 0; i < len; i++) {
      const rnum = Math.floor(Math.random() * chars.length);
      randomstring += chars.substring(rnum, rnum + 1);
    }
    return randomstring;
  };

  helper.getFrameJQuery = async ($iframe, includeSendkeys = false) => {
    const win = $iframe[0].contentWindow;
    const doc = win.document;

    const load = async (url) => {
      const elem = doc.createElement('script');
      elem.setAttribute('src', url);
      const p = new Promise((resolve, reject) => {
        const handler = (evt) => {
          elem.removeEventListener('load', handler);
          elem.removeEventListener('error', handler);
          if (evt.type === 'error') return reject(new Error(`failed to load ${url}`));
          resolve();
        };
        elem.addEventListener('load', handler);
        elem.addEventListener('error', handler);
      });
      doc.head.appendChild(elem);
      await p;
    };

    if (!win.$) await load('../../static/js/vendors/jquery.js');
    // sendkeys.js depends on jQuery, so it cannot be loaded until jQuery has finished loading. (In
    // other words, do not load both jQuery and sendkeys inside a Promise.all() call.)
    if (!win.bililiteRange && includeSendkeys) await load('../tests/frontend/lib/sendkeys.js');

    win.$.window = win;
    win.$.document = doc;

    return win.$;
  };

  helper.clearSessionCookies = () => {
    window.Cookies.remove('token');
    window.Cookies.remove('language');
  };

  // Can only happen when the iframe exists, so we're doing it separately from other cookies
  helper.clearPadPrefCookie = () => {
    const {padcookie} = helper.padChrome$.window.require('ep_etherpad-lite/static/js/pad_cookie');
    padcookie.clear();
  };

  // Overwrite all prefs in pad cookie.
  helper.setPadPrefCookie = (prefs) => {
    const {padcookie} = helper.padChrome$.window.require('ep_etherpad-lite/static/js/pad_cookie');
    padcookie.clear();
    for (const [key, value] of Object.entries(prefs)) padcookie.setPref(key, value);
  };

  // Functionality for knowing what key event type is required for tests
  let evtType = 'keydown';
  // if it's IE require keypress
  if (window.navigator.userAgent.indexOf('MSIE') > -1) {
    evtType = 'keypress';
  }
  // Edge also requires keypress.
  if (window.navigator.userAgent.indexOf('Edge') > -1) {
    evtType = 'keypress';
  }
  // Opera also requires keypress.
  if (window.navigator.userAgent.indexOf('OPR') > -1) {
    evtType = 'keypress';
  }
  helper.evtType = evtType;

  // Deprecated; use helper.aNewPad() instead.
  helper.newPad = (opts, id) => {
    if (!id) id = `FRONTEND_TEST_${helper.randomString(20)}`;
    opts = Object.assign({id}, typeof opts === 'function' ? {cb: opts} : opts);
    const {cb = (err) => { if (err != null) throw err; }} = opts;
    delete opts.cb;
    helper.aNewPad(opts).then((id) => cb(null, id), (err) => cb(err || new Error(err)));
    return id;
  };

  helper.aNewPad = async (opts = {}) => {
    opts = Object.assign({
      _retry: 0,
      clearCookies: true,
      id: `FRONTEND_TEST_${helper.randomString(20)}`,
      hookFns: {},
    }, opts);

    // Set up socket.io spying as early as possible.
    /** chat messages received */
    helper.chatMessages = [];
    /** changeset commits from the server */
    helper.commits = [];
    /** userInfo messages from the server */
    helper.userInfos = [];
    if (opts.hookFns._socketCreated == null) opts.hookFns._socketCreated = [];
    opts.hookFns._socketCreated.unshift(() => helper.spyOnSocketIO());

    // if opts.params is set we manipulate the URL to include URL parameters IE ?foo=Bah.
    let encodedParams;
    if (opts.params) {
      encodedParams = `?${$.param(opts.params)}`;
    }
    let hash;
    if (opts.hash) {
      hash = `#${opts.hash}`;
    }

    // clear cookies
    if (opts.clearCookies) {
      helper.clearSessionCookies();
    }

    $iframe = $(`<iframe src='/p/${opts.id}${hash || ''}${encodedParams || ''}'></iframe>`);

    // clean up inner iframe references
    helper.padChrome$ = helper.padOuter$ = helper.padInner$ = null;

    // remove old iframe
    $('#iframe-container iframe').remove();
    // set new iframe
    $('#iframe-container').append($iframe);
    await Promise.all([
      new Promise((resolve) => $iframe.one('load', resolve)),
      // Install the hook functions as early as possible because some of them fire right away.
      new Promise((resolve, reject) => {
        if ($iframe[0].contentWindow._postPluginUpdateForTestingDone) {
          return reject(new Error(
              'failed to set _postPluginUpdateForTesting before it would have been called'));
        }
        $iframe[0].contentWindow._postPluginUpdateForTesting = () => {
          const {hooks} =
                $iframe[0].contentWindow.require('ep_etherpad-lite/static/js/pluginfw/plugin_defs');
          for (const [hookName, hookFns] of Object.entries(opts.hookFns)) {
            if (hooks[hookName] == null) hooks[hookName] = [];
            hooks[hookName].push(
                ...hookFns.map((hookFn) => ({hook_name: hookName, hook_fn: hookFn})));
          }
          resolve();
        };
      }),
    ]);
    helper.padChrome$ = await helper.getFrameJQuery($('#iframe-container iframe'), true);
    helper.padChrome$.padeditor =
        helper.padChrome$.window.require('ep_etherpad-lite/static/js/pad_editor').padeditor;
    if (opts.clearCookies) {
      helper.clearPadPrefCookie();
    }
    if (opts.padPrefs) {
      helper.setPadPrefCookie(opts.padPrefs);
    }
    const $loading = helper.padChrome$('#editorloadingbox');
    const $container = helper.padChrome$('#editorcontainer');
    try {
      await helper.waitForPromise(
          () => !$loading.is(':visible') && $container.hasClass('initialized'), 10000);
    } catch (err) {
      if (opts._retry++ >= 4) throw new Error('Pad never loaded');
      return await helper.aNewPad(opts);
    }
    helper.padOuter$ =
        await helper.getFrameJQuery(helper.padChrome$('iframe[name="ace_outer"]'), false);
    helper.padInner$ =
        await helper.getFrameJQuery(helper.padOuter$('iframe[name="ace_inner"]'), true);

    // disable all animations, this makes tests faster and easier
    helper.padChrome$.fx.off = true;
    helper.padOuter$.fx.off = true;
    helper.padInner$.fx.off = true;

    // Don't return opts.id -- the server might have redirected the browser to a transformed version
    // of the requested pad ID.
    return helper.padChrome$.window.clientVars.padId;
  };

  helper.newAdmin = async (page) => {
    // define the iframe
    $iframe = $(`<iframe src='/admin/${page}'></iframe>`);

    // clean up inner iframe references
    helper.admin$ = null;

    // remove old iframe
    $('#iframe-container iframe').remove();
    // set new iframe
    $('#iframe-container').append($iframe);
    $iframe.one('load', async () => {
      helper.admin$ = await helper.getFrameJQuery($('#iframe-container iframe'), false);
    });
  };

  helper.waitFor = (conditionFunc, timeoutTime = 1900, intervalTime = 10) => {
    // Create an Error object to use if the condition is never satisfied. This is created here so
    // that the Error has a useful stack trace associated with it.
    const timeoutError =
        new Error(`waitFor condition never became true ${conditionFunc.toString()}`);
    const deferred = new $.Deferred();

    const _fail = deferred.fail.bind(deferred);
    let listenForFail = false;
    deferred.fail = (...args) => {
      listenForFail = true;
      return _fail(...args);
    };

    const check = async () => {
      try {
        if (!await conditionFunc()) return;
        deferred.resolve();
      } catch (err) {
        deferred.reject(err);
      }
      clearInterval(intervalCheck);
      clearTimeout(timeout);
    };

    const intervalCheck = setInterval(check, intervalTime);

    const timeout = setTimeout(() => {
      clearInterval(intervalCheck);
      deferred.reject(timeoutError);

      if (!listenForFail) {
        throw timeoutError;
      }
    }, timeoutTime);

    // Check right away to avoid an unnecessary sleep if the condition is already true.
    check();

    return deferred;
  };

  /**
   * Same as `waitFor` but using Promises
   *
   * @returns {Promise}
   *
   */
  // Note: waitFor() has a strange API: On timeout it rejects, but it also throws an uncatchable
  // exception unless .fail() has been called. That uncatchable exception is disabled here by
  // passing a no-op function to .fail().
  helper.waitForPromise = async (...args) => await helper.waitFor(...args).fail(() => {});

  helper.selectLines = ($startLine, $endLine, startOffset, endOffset) => {
    // if no offset is provided, use beginning of start line and end of end line
    startOffset = startOffset || 0;
    endOffset = endOffset === undefined ? $endLine.text().length : endOffset;

    const inner$ = helper.padInner$;
    const selection = inner$.document.getSelection();
    const range = selection.getRangeAt(0);

    const start = getTextNodeAndOffsetOf($startLine, startOffset);
    const end = getTextNodeAndOffsetOf($endLine, endOffset);

    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);

    selection.removeAllRanges();
    selection.addRange(range);
  };

  // Temporarily reduces minimum time between commits and calls the provided function with a single
  // argument: a function that immediately incorporates all pad edits (as opposed to waiting for the
  // idle timer to fire).
  helper.withFastCommit = async (fn) => {
    const incorp = () => helper.padChrome$.padeditor.ace.callWithAce(
        (ace) => ace.ace_inCallStackIfNecessary('helper.edit', () => ace.ace_fastIncorp()));
    const cc = helper.padChrome$.window.pad.collabClient;
    const {commitDelay} = cc;
    cc.commitDelay = 0;
    try {
      return await fn(incorp);
    } finally {
      cc.commitDelay = commitDelay;
    }
  };

  const getTextNodeAndOffsetOf = ($targetLine, targetOffsetAtLine) => {
    const $textNodes = $targetLine.find('*').contents().filter(function () {
      return this.nodeType === Node.TEXT_NODE;
    });

    // search node where targetOffsetAtLine is reached, and its 'inner offset'
    let textNodeWhereOffsetIs = null;
    let offsetBeforeTextNode = 0;
    let offsetInsideTextNode = 0;
    $textNodes.each((index, element) => {
      const elementTotalOffset = element.textContent.length;
      textNodeWhereOffsetIs = element;
      offsetInsideTextNode = targetOffsetAtLine - offsetBeforeTextNode;

      const foundTextNode = offsetBeforeTextNode + elementTotalOffset >= targetOffsetAtLine;
      if (foundTextNode) {
        return false; // stop .each by returning false
      }

      offsetBeforeTextNode += elementTotalOffset;
    });

    // edge cases
    if (textNodeWhereOffsetIs == null) {
      // there was no text node inside $targetLine, so it is an empty line (<br>).
      // Use beginning of line
      textNodeWhereOffsetIs = $targetLine.get(0);
      offsetInsideTextNode = 0;
    }
    // avoid errors if provided targetOffsetAtLine is higher than line offset (maxOffset).
    // Use max allowed instead
    const maxOffset = textNodeWhereOffsetIs.textContent.length;
    offsetInsideTextNode = Math.min(offsetInsideTextNode, maxOffset);

    return {
      node: textNodeWhereOffsetIs,
      offset: offsetInsideTextNode,
    };
  };

  /* Ensure console.log doesn't blow up in IE, ugly but ok for a test framework imho*/
  window.console = window.console || {};
  window.console.log = window.console.log || (() => {});
})();
