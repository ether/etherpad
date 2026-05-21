'use strict';

// The timeslider page loads margin's pad.css, whose theme tokens live under
// [data-theme="..."][data-mode="..."]. Without this bootstrap the history
// view (and the in-place #history-frame iframe spun up by pad_mode.ts) would
// render with no theme applied GÇö visually broken vs the pad it came from.
// Keep this list in sync with MARGIN_THEMES in pad.js.
const MARGIN_THEME_VALUES = [
  'colibris', 'editorial', 'brutalist', 'paper', 'crt', 'industrial',
];
const MARGIN_THEME_DEFAULT = 'colibris';
const MARGIN_MODE_DEFAULTS = {
  colibris: 'light', editorial: 'light', brutalist: 'light',
  paper: 'light', crt: 'dark', industrial: 'dark',
};

const readStorage = (key) => {
  try { return localStorage.getItem(key); } catch (_) { return null; }
};

// When opened as the in-place history iframe (#history-frame) prefer the
// parent doc's live attribute over localStorage GÇö that way history mirrors
// whatever the pad currently shows even if the user toggled theme after
// localStorage was last written.
const readFromParent = (attr) => {
  try {
    if (window.parent && window.parent !== window) {
      return window.parent.document.documentElement.getAttribute(attr);
    }
  } catch (_) { /* cross-origin GÇö ignore */ }
  return null;
};

let theme = readFromParent('data-theme') || readStorage('marginTheme');
if (!MARGIN_THEME_VALUES.includes(theme)) theme = MARGIN_THEME_DEFAULT;
let mode = readFromParent('data-mode') || readStorage('marginMode');
if (mode !== 'light' && mode !== 'dark') mode = MARGIN_MODE_DEFAULTS[theme] || 'light';
document.documentElement.setAttribute('data-theme', theme);
document.documentElement.setAttribute('data-mode', mode);

window.customStart = () => {
};
