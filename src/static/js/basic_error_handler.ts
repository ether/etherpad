// @ts-nocheck
// @license magnet:?xt=urn:btih:8e4f440f4c65981c5bf93c76d35135ba5064d8b7&dn=apache-2.0.txt Apache-2.0

/* Copyright 2021 Richard Hansen <rhansen@rhansen.org> */

'use strict';

// Set up an error handler to display errors that happen during page load. This handler will be
// overridden with a nicer handler by setupGlobalExceptionHandler() in pad_utils.js.

(() => {
  const originalHandler = window.onerror;
  window.onerror = (...args) => {
    const [msg, url, line, col, err] = args;

    // Purge the existing HTML and styles for a consistent view.
    document.body.textContent = '';
    for (const el of document.querySelectorAll('head style, head link[rel="stylesheet"]')) {
      el.remove();
    }

    const box = document.body;
    box.textContent = '';
    const summary = document.createElement('p');
    box.appendChild(summary);
    summary.appendChild(document.createTextNode('An error occurred while loading the page.'));
    const reload = document.createElement('p');
    box.appendChild(reload);
    reload.appendChild(document.createTextNode(
      'Please press Ctrl+F5 to reload. If the problem persists, contact your webmaster.'));

    // Log the error details to the console for debugging, but don't show them to the user.
    // See https://github.com/ether/etherpad-lite/issues/5765
    console.error('Page load error:', msg, `\n  at ${url}:${line}:${col}`, err?.stack || err);

    if (typeof originalHandler === 'function') originalHandler(...args);
  };
})();

// @license-end
