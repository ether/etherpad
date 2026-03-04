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

// requires: top
// requires: undefined

const hooks = require('./pluginfw/hooks');
const makeCSSManager = require('./cssmanager').makeCSSManager;
const pluginUtils = require('./pluginfw/shared');
const ace2_inner = require('ep_etherpad-lite/static/js/ace2_inner')
const debugLog = (...args) => {};
const cl_plugins = require('ep_etherpad-lite/static/js/pluginfw/client_plugins')
const rJQuery = require('ep_etherpad-lite/static/js/rjquery')
// The inner and outer iframe's locations are about:blank, so relative URLs are relative to that.
// Firefox and Chrome seem to do what the developer intends if given a relative URL, but Safari
// errors out unless given an absolute URL for a JavaScript-created element.
const absUrl = (url) => new URL(url, window.location.href).href;

const eventFired = async (obj, event, cleanups = [], predicate = () => true) => {
  if (typeof cleanups === 'function') {
    predicate = cleanups;
    cleanups = [];
  }
  await new Promise((resolve, reject) => {
    let cleanup;
    const successCb = () => {
      if (!predicate()) return;
      debugLog(`Ace2Editor.init() ${event} event on`, obj);
      cleanup();
      resolve();
    };
    const errorCb = () => {
      const err = new Error(`Ace2Editor.init() error event while waiting for ${event} event`);
      debugLog(`${err} on object`, obj);
      cleanup();
      reject(err);
    };
    cleanup = () => {
      cleanup = () => {};
      obj.removeEventListener(event, successCb);
      obj.removeEventListener('error', errorCb);
    };
    cleanups.push(cleanup);
    obj.addEventListener(event, successCb);
    obj.addEventListener('error', errorCb);
  });
};

// Resolves when the frame's document is ready to be mutated. Browsers seem to be quirky about
// iframe ready events so this function throws the kitchen sink at the problem. Maybe one day we'll
// find a concise general solution.
const frameReady = async (frame) => {
  // Can't do `const doc = frame.contentDocument;` because Firefox seems to asynchronously replace
  // the document object after the frame is first created for some reason. ¯\_(ツ)_/¯
  const doc = () => frame.contentDocument;
  const cleanups = [];
  try {
    await Promise.race([
      eventFired(frame, 'load', cleanups),
      eventFired(frame.contentWindow, 'load', cleanups),
      eventFired(doc(), 'load', cleanups),
      eventFired(doc(), 'DOMContentLoaded', cleanups),
      eventFired(doc(), 'readystatechange', cleanups, () => doc.readyState === 'complete'),
    ]);
  } finally {
    for (const cleanup of cleanups) cleanup();
  }
};

const Ace2Editor = function () {
  let info = {editor: this};
  let loaded = false;

  let actionsPendingInit = [];

  const pendingInit = (func) => function (...args) {
    const action = () => func.apply(this, args);
    if (loaded) return action();
    actionsPendingInit.push(action);
  };

  const doActionsPendingInit = () => {
    for (const fn of actionsPendingInit) fn();
    actionsPendingInit = [];
  };

  // The following functions (prefixed by 'ace_')  are exposed by editor, but
  // execution is delayed until init is complete
  const aceFunctionsPendingInit = [
    'importText',
    'importAText',
    'focus',
    'setEditable',
    'setOnKeyPress',
    'setOnKeyDown',
    'setNotifyDirty',
    'setProperty',
    'setBaseText',
    'setBaseAttributedText',
    'applyChangesToBase',
    'applyPreparedChangesetToBase',
    'setUserChangeNotificationCallback',
    'setAuthorInfo',
    'callWithAce',
    'execCommand',
    'replaceRange',
  ];

  for (const fnName of aceFunctionsPendingInit) {
    // Note: info[`ace_${fnName}`] does not exist yet, so it can't be passed directly to
    // pendingInit(). A simple wrapper is used to defer the info[`ace_${fnName}`] lookup until
    // method invocation.
    this[fnName] = pendingInit(function (...args) {
      info[`ace_${fnName}`].apply(this, args);
    });
  }

  this.exportText = () => loaded ? info.ace_exportText() : '(awaiting init)\n';

  this.getInInternationalComposition =
      () => loaded ? info.ace_getInInternationalComposition() : null;

  // prepareUserChangeset:
  // Returns null if no new changes or ACE not ready.  Otherwise, bundles up all user changes
  // to the latest base text into a Changeset, which is returned (as a string if encodeAsString).
  // If this method returns a truthy value, then applyPreparedChangesetToBase can be called at some
  // later point to consider these changes part of the base, after which prepareUserChangeset must
  // be called again before applyPreparedChangesetToBase. Multiple consecutive calls to
  // prepareUserChangeset will return an updated changeset that takes into account the latest user
  // changes, and modify the changeset to be applied by applyPreparedChangesetToBase accordingly.
  this.prepareUserChangeset = () => loaded ? info.ace_prepareUserChangeset() : null;

  const addStyleTagsFor = (doc, files) => {
    for (const file of files) {
      const link = doc.createElement('link');
      link.rel = 'stylesheet';
      link.type = 'text/css';
      link.href = absUrl(encodeURI(file));
      doc.head.appendChild(link);
    }
  };

  this.destroy = pendingInit(() => {
    info.ace_dispose();
    info.frame.parentNode.removeChild(info.frame);
    info = null; // prevent IE 6 closure memory leaks
  });

  this.init = async function (containerId, initialCode) {
    debugLog('Ace2Editor.init()');
    this.importText(initialCode);

    const includedCSS = [
      `../static/css/iframe_editor.css?v=${clientVars.randomVersionString}`,
      `../static/css/pad.css?v=${clientVars.randomVersionString}`,
      ...hooks.callAll('aceEditorCSS').map(
          // Allow urls to external CSS - http(s):// and //some/path.css
          (p) => /\/\//.test(p) ? p : `../static/plugins/${p}`),
      `../static/skins/${clientVars.skinName}/pad.css?v=${clientVars.randomVersionString}`,
    ];

    const skinVariants = clientVars.skinVariants.split(' ').filter((x) => x !== '');

    const outerFrame = document.createElement('iframe');
    outerFrame.name = 'ace_outer';
    outerFrame.frameBorder = 0; // for IE
    outerFrame.title = 'Ether';
    // Some browsers do strange things unless the iframe has a src or srcdoc property:
    //   - Firefox replaces the frame's contentWindow.document object with a different object after
    //     the frame is created. This can be worked around by waiting for the window's load event
    //     before continuing.
    //   - Chrome never fires any events on the frame or document. Eventually the document's
    //     readyState becomes 'complete' even though it never fires a readystatechange event.
    //   - Safari behaves like Chrome.
    // srcdoc is avoided because Firefox's Content Security Policy engine does not properly handle
    // 'self' with nested srcdoc iframes: https://bugzilla.mozilla.org/show_bug.cgi?id=1721296
    outerFrame.src = '../static/empty.html';
    info.frame = outerFrame;
    document.getElementById(containerId).appendChild(outerFrame);
    const outerWindow = outerFrame.contentWindow;

    debugLog('Ace2Editor.init() waiting for outer frame');
    await frameReady(outerFrame);
    debugLog('Ace2Editor.init() outer frame ready');

    // Firefox might replace the outerWindow.document object after iframe creation so this variable
    // is assigned after the Window's load event.
    const outerDocument = outerWindow.document;

    // <html> tag
    outerDocument.documentElement.classList.add('outer-editor', 'outerdoc', ...skinVariants);

    // <head> tag
    addStyleTagsFor(outerDocument, includedCSS);
    const outerStyle = outerDocument.createElement('style');
    outerStyle.type = 'text/css';
    outerStyle.title = 'dynamicsyntax';
    outerDocument.head.appendChild(outerStyle);

    // <body> tag
    outerDocument.body.id = 'outerdocbody';
    outerDocument.body.classList.add('outerdocbody', ...pluginUtils.clientPluginNames());
    const sideDiv = outerDocument.createElement('div');
    sideDiv.id = 'sidediv';
    sideDiv.classList.add('sidediv');
    outerDocument.body.appendChild(sideDiv);
    const sideDivInner = outerDocument.createElement('div');
    sideDivInner.id = 'sidedivinner';
    sideDivInner.classList.add('sidedivinner');
    sideDiv.appendChild(sideDivInner);
    const lineMetricsDiv = outerDocument.createElement('div');
    lineMetricsDiv.id = 'linemetricsdiv';
    lineMetricsDiv.appendChild(outerDocument.createTextNode('x'));
    outerDocument.body.appendChild(lineMetricsDiv);

    const innerFrame = outerDocument.createElement('iframe');
    innerFrame.name = 'ace_inner';
    innerFrame.title = 'pad';
    innerFrame.scrolling = 'no';
    innerFrame.frameBorder = 0;
    innerFrame.allowTransparency = true; // for IE
    // The iframe MUST have a src or srcdoc property to avoid browser quirks. See the comment above
    // outerFrame.srcdoc.
    innerFrame.src = 'empty.html';
    outerDocument.body.insertBefore(innerFrame, outerDocument.body.firstChild);
    const innerWindow = innerFrame.contentWindow;

    debugLog('Ace2Editor.init() waiting for inner frame');
    await frameReady(innerFrame);
    debugLog('Ace2Editor.init() inner frame ready');

    // Firefox might replace the innerWindow.document object after iframe creation so this variable
    // is assigned after the Window's load event.
    const innerDocument = innerWindow.document;

    // <html> tag
    innerDocument.documentElement.classList.add('inner-editor', ...skinVariants);

    // <head> tag
    addStyleTagsFor(innerDocument, includedCSS);
    //const requireKernel = innerDocument.createElement('script');
    //requireKernel.type = 'text/javascript';
    //requireKernel.src =
     //   absUrl(`../static/js/require-kernel.js?v=${clientVars.randomVersionString}`);
    //innerDocument.head.appendChild(requireKernel);
    // Pre-fetch modules to improve load performance.
    /*for (const module of ['ace2_inner', 'ace2_common']) {
      const script = innerDocument.createElement('script');
      script.type = 'text/javascript';
      script.src = absUrl(`../javascripts/lib/ep_etherpad-lite/static/js/${module}.js` +
                          `?callback=require.define&v=${clientVars.randomVersionString}`);
      innerDocument.head.appendChild(script);
    }*/
    const innerStyle = innerDocument.createElement('style');
    innerStyle.type = 'text/css';
    innerStyle.title = 'dynamicsyntax';
    innerDocument.head.appendChild(innerStyle);
    const headLines = [];
    hooks.callAll('aceInitInnerdocbodyHead', {iframeHTML: headLines});
    innerDocument.head.appendChild(
        innerDocument.createRange().createContextualFragment(headLines.join('\n')));

    // <body> tag
    innerDocument.body.id = 'innerdocbody';
    innerDocument.body.classList.add('innerdocbody');
    innerDocument.body.setAttribute('spellcheck', 'false');
    innerDocument.body.appendChild(innerDocument.createTextNode('\u00A0')); // &nbsp;
/*
    debugLog('Ace2Editor.init() waiting for require kernel load');
    await eventFired(requireKernel, 'load');
    debugLog('Ace2Editor.init() require kernel loaded');
    const require = innerWindow.require;
    require.setRootURI(absUrl('../javascripts/src'));
    require.setLibraryURI(absUrl('../javascripts/lib'));
    require.setGlobalKeyPath('require');
*/
    // intentially moved before requiring client_plugins to save a 307
    innerWindow.Ace2Inner = ace2_inner;
    innerWindow.plugins = cl_plugins;

    innerWindow.$ = innerWindow.jQuery = rJQuery.jQuery;

    debugLog('Ace2Editor.init() waiting for plugins');
    /*await new Promise((resolve, reject) => innerWindow.plugins.ensure(
        (err) => err != null ? reject(err) : resolve()));*/
    debugLog('Ace2Editor.init() waiting for Ace2Inner.init()');
    await innerWindow.Ace2Inner.init(info, {
      inner: makeCSSManager(innerStyle.sheet),
      outer: makeCSSManager(outerStyle.sheet),
      parent: makeCSSManager(document.querySelector('style[title="dynamicsyntax"]').sheet),
    });
    debugLog('Ace2Editor.init() Ace2Inner.init() returned');
    loaded = true;
    doActionsPendingInit();
    debugLog('Ace2Editor.init() done');
  };
};

exports.Ace2Editor = Ace2Editor;
