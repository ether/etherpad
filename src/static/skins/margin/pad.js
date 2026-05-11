'use strict';

const MAX_PADS_IN_HISTORY = 3;
// Ordered list of selectable themes. `value` is the data-theme attribute slug
// (used in pad.css [data-theme="..."] selectors); `label` is the dropdown
// option text. Colibris is the default and lives at the top.
const MARGIN_THEMES = [
  {value: 'colibris',          label: 'Colibris'},
  {value: 'editorial',         label: 'Editorial · Light'},
  {value: 'editorial-dark',    label: 'Editorial · Dark'},
  {value: 'brutalist',         label: 'Brutalist · Light'},
  {value: 'brutalist-dark',    label: 'Brutalist · Dark'},
  {value: 'paper',             label: 'Paper · Light'},
  {value: 'paper-dark',        label: 'Paper · Dark'},
  {value: 'crt-light',         label: 'CRT · Light'},
  {value: 'crt',               label: 'CRT · Dark'},
  {value: 'industrial-light',  label: 'Industrial · Light'},
  {value: 'industrial',        label: 'Industrial · Dark'},
];
const MARGIN_THEME_VALUES = MARGIN_THEMES.map((t) => t.value);
const MARGIN_THEME_DEFAULT = 'colibris';
const MARGIN_THEME_KEY = 'marginTheme';

const applyMarginTheme = (theme) => {
  if (!MARGIN_THEME_VALUES.includes(theme)) theme = MARGIN_THEME_DEFAULT;
  document.documentElement.setAttribute('data-theme', theme);
  try { localStorage.setItem(MARGIN_THEME_KEY, theme); } catch (_) { /* private mode */ }
};

// Apply saved or default theme as early as possible so first paint matches.
try {
  const saved = localStorage.getItem(MARGIN_THEME_KEY);
  applyMarginTheme(saved || MARGIN_THEME_DEFAULT);
} catch (_) {
  applyMarginTheme(MARGIN_THEME_DEFAULT);
}

// Build a single dropdown-line row mirroring the markup used by the built-in
// Font type / Language rows so margin's Theme picker inherits the same
// styling. `selectId` keeps the user-settings vs pad-settings copies distinct.
const buildThemeRow = (selectId) => {
  const row = document.createElement('p');
  row.className = 'dropdown-line margin-theme-row';
  const label = document.createElement('label');
  label.htmlFor = selectId;
  // Match the colon convention used by the built-in "Font type:" / "Language:"
  // rows so the field reads consistently in the Settings popup.
  label.textContent = 'Theme:';
  // popup.css sets `.popup .dropdowns-container label { width: 120px;
  // display: inline-block }`, but apply it inline too so the select's
  // left edge sits at exactly the same x as the Font type / Language
  // selects regardless of stylesheet load order.
  label.style.cssText = 'width: 120px; display: inline-block;';
  const select = document.createElement('select');
  select.id = selectId;
  MARGIN_THEMES.forEach(({value, label: optLabel}) => {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = optLabel;
    select.appendChild(opt);
  });
  select.value = document.documentElement.getAttribute('data-theme') || MARGIN_THEME_DEFAULT;
  // nice-select wraps <select> and dispatches change via $().trigger('change'),
  // which only fires jQuery-bound handlers — not native addEventListener. Bind
  // through jQuery so the widget actually drives applyMarginTheme.
  $(select).on('change', () => {
    applyMarginTheme(select.value);
    // Mirror to the sibling select (user-settings ↔ pad-settings).
    $('.margin-theme-row select').each(function () {
      if (this !== select) this.value = select.value;
    });
    if ($.fn.niceSelect) $('.margin-theme-row select').niceSelect('update');
  });
  row.appendChild(label);
  row.appendChild(select);
  return row;
};

const injectThemeSelector = () => {
  // Two .dropdowns-container blocks exist: user settings + pad-wide settings.
  const containers = [
    {host: '#user-settings-section .dropdowns-container', id: 'margin-theme-user'},
    {host: '#pad-settings-section .dropdowns-container',  id: 'margin-theme-pad'},
  ];
  let injectedAny = false;
  let allDone = true;
  let injectedThisCall = false;
  containers.forEach(({host, id}) => {
    if (document.getElementById(id)) { injectedAny = true; return; }
    const target = document.querySelector(host);
    if (!target) { allDone = false; return; }
    target.appendChild(buildThemeRow(id));
    injectedAny = true;
    injectedThisCall = true;
  });
  // Etherpad runs $('select').niceSelect() once at pad-init (pad_editbar.ts),
  // so a freshly appended <select> is still native chrome. Wrap ours now so
  // it matches the Font type / Language widgets visually.
  if (injectedThisCall && window.$ && $.fn.niceSelect) {
    $('.margin-theme-row select').niceSelect();
  }
  return injectedAny && allDone;
};

// Propagate data-theme from the host page into the editor iframes so
// [data-theme=...] rules in pad-editor.css apply inside them.
const propagateTheme = () => {
  try {
    const theme = document.documentElement.getAttribute('data-theme');
    if (!theme) return;
    const setOn = (doc) => {
      if (!doc) return;
      if (doc.documentElement) doc.documentElement.setAttribute('data-theme', theme);
      const outerBody = doc.getElementById && doc.getElementById('outerdocbody');
      if (outerBody) outerBody.setAttribute('data-theme', theme);
      const innerBody = doc.getElementById && doc.getElementById('innerdocbody');
      if (innerBody) innerBody.setAttribute('data-theme', theme);
    };
    const outer = document.querySelector('iframe[name="ace_outer"]');
    if (!outer) return;
    setOn(outer.contentDocument);
    const inner = outer.contentDocument && outer.contentDocument.querySelector('iframe[name="ace_inner"]');
    if (inner) setOn(inner.contentDocument);
  } catch (_) { /* iframe not ready yet */ }
};

window.customStart = () => {
  $('#pad_title').show();
  $('.buttonicon').on('mousedown', function () { $(this).parent().addClass('pressed'); });
  $('.buttonicon').on('mouseup', function () { $(this).parent().removeClass('pressed'); });

  // Inject the Theme selector into Settings → user-settings section.
  // Retry until the popup DOM is mounted (it's rendered eagerly in pad.html
  // but we keep a short poll for safety).
  let injectAttempts = 0;
  const injectTick = setInterval(() => {
    if (injectThemeSelector() || ++injectAttempts > 40) clearInterval(injectTick);
  }, 250);

  // Try repeatedly until iframes have mounted.
  let attempts = 0;
  const tick = setInterval(() => {
    propagateTheme();
    if (++attempts > 40) clearInterval(tick); // ~10s
  }, 250);
  // Also re-apply if theme is changed at runtime
  new MutationObserver(propagateTheme).observe(document.documentElement, {
    attributes: true, attributeFilter: ['data-theme'],
  });

  const pathSegments = window.location.pathname.split('/');
  const padName = pathSegments[pathSegments.length - 1];
  const recentPads = localStorage.getItem('recentPads');
  if (recentPads == null) {
    localStorage.setItem('recentPads', JSON.stringify([]));
  }
  const recentPadsList = JSON.parse(localStorage.getItem('recentPads'));
  if (!recentPadsList.some((pad) => pad.name === padName)) {
    if (recentPadsList.length >= MAX_PADS_IN_HISTORY) {
      recentPadsList.shift(); // Remove the oldest pad if we have more than 10
    }
    recentPadsList.push({
      name: padName,
      timestamp: new Date().toISOString(), // Store the timestamp for sorting
      members: 1,
    });
    localStorage.setItem('recentPads', JSON.stringify(recentPadsList));
  } else {
    // Update the timestamp if the pad already exists
    const existingPad = recentPadsList.find((pad) => pad.name === padName);
    if (existingPad) {
      existingPad.timestamp = new Date().toISOString();
    }
    localStorage.setItem('recentPads', JSON.stringify(recentPadsList));
  }
};
