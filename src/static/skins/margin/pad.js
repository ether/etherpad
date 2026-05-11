'use strict';

const MAX_PADS_IN_HISTORY = 3;
// Selectable themes — orthogonal to light/dark mode. `value` is the
// data-theme attribute slug used in pad.css [data-theme="…"] selectors;
// `label` is the dropdown option text. Colibris is the default.
const MARGIN_THEMES = [
  {value: 'colibris',   label: 'Colibris'},
  {value: 'editorial',  label: 'Editorial'},
  {value: 'brutalist',  label: 'Brutalist'},
  {value: 'paper',      label: 'Paper'},
  {value: 'crt',        label: 'CRT'},
  {value: 'industrial', label: 'Industrial'},
];
const MARGIN_THEME_VALUES = MARGIN_THEMES.map((t) => t.value);
const MARGIN_THEME_DEFAULT = 'colibris';
const MARGIN_THEME_KEY = 'marginTheme';

// Light/dark mode is orthogonal — paired with the theme in CSS via
// [data-theme="X"][data-mode="light|dark"]. Colibris has only a light palette;
// the others define both. Each theme has a "natural" default mode used when
// the user hasn't expressed a preference (CRT/Industrial start dark, the
// rest start light).
const MARGIN_MODE_KEY = 'marginMode';
const MARGIN_MODE_DEFAULTS = {
  colibris: 'light',
  editorial: 'light',
  brutalist: 'light',
  paper: 'light',
  crt: 'dark',
  industrial: 'dark',
};

const applyMarginTheme = (theme) => {
  if (!MARGIN_THEME_VALUES.includes(theme)) theme = MARGIN_THEME_DEFAULT;
  document.documentElement.setAttribute('data-theme', theme);
  try { localStorage.setItem(MARGIN_THEME_KEY, theme); } catch (_) { /* private mode */ }
};

const applyMarginMode = (mode) => {
  if (mode !== 'light' && mode !== 'dark') mode = 'light';
  document.documentElement.setAttribute('data-mode', mode);
  try { localStorage.setItem(MARGIN_MODE_KEY, mode); } catch (_) { /* private mode */ }
};

// Apply saved or default theme + mode as early as possible so first paint
// matches the user's last choice. If no mode is saved, fall back to the
// natural default for the selected theme.
let initialTheme = MARGIN_THEME_DEFAULT;
let initialMode = MARGIN_MODE_DEFAULTS[MARGIN_THEME_DEFAULT];
try {
  initialTheme = localStorage.getItem(MARGIN_THEME_KEY) || initialTheme;
  initialMode = localStorage.getItem(MARGIN_MODE_KEY) || MARGIN_MODE_DEFAULTS[initialTheme] || 'light';
} catch (_) { /* private mode */ }
applyMarginTheme(initialTheme);
applyMarginMode(initialMode);

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

// Build the Dark mode toggle row. Same checkbox-on-label pattern as the
// existing "Disable Chat" / "Show line numbers" rows in pad.html so margin's
// form.css picks up identical chrome.
const buildDarkModeRow = (checkboxId) => {
  const row = document.createElement('p');
  row.className = 'margin-mode-row';
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.id = checkboxId;
  checkbox.checked = document.documentElement.getAttribute('data-mode') === 'dark';
  const label = document.createElement('label');
  label.htmlFor = checkboxId;
  label.textContent = 'Dark mode';
  $(checkbox).on('change', () => {
    applyMarginMode(checkbox.checked ? 'dark' : 'light');
    $('.margin-mode-row input[type="checkbox"]').each(function () {
      if (this !== checkbox) this.checked = checkbox.checked;
    });
  });
  row.appendChild(checkbox);
  row.appendChild(label);
  return row;
};

const injectThemeSelector = () => {
  // Two .dropdowns-container blocks exist: user settings + pad-wide settings.
  // Mirror the Theme dropdown into both and the Dark mode toggle into the
  // section the column lives in (so the row sits next to other checkboxes).
  const sections = [
    {
      sectionId: 'user-settings-section',
      dropdownId: 'margin-theme-user',
      checkboxId: 'margin-mode-user',
    },
    {
      sectionId: 'pad-settings-section',
      dropdownId: 'margin-theme-pad',
      checkboxId: 'margin-mode-pad',
    },
  ];
  let injectedAny = false;
  let allDone = true;
  let injectedThisCall = false;
  sections.forEach(({sectionId, dropdownId, checkboxId}) => {
    const section = document.getElementById(sectionId);
    if (!section) { allDone = false; return; }
    const dropdownsContainer = section.querySelector('.dropdowns-container');
    if (!dropdownsContainer) { allDone = false; return; }
    if (!document.getElementById(dropdownId)) {
      dropdownsContainer.appendChild(buildThemeRow(dropdownId));
      injectedThisCall = true;
    }
    if (!document.getElementById(checkboxId)) {
      // Place the Dark mode checkbox among the section's other checkboxes,
      // before the dropdowns container so it reads in toggle-then-pickers
      // order — matching the natural top-to-bottom flow of the section.
      section.insertBefore(buildDarkModeRow(checkboxId), dropdownsContainer);
    }
    injectedAny = true;
  });
  // Etherpad runs $('select').niceSelect() once at pad-init (pad_editbar.ts),
  // so a freshly appended <select> is still native chrome. Wrap ours now so
  // it matches the Font type / Language widgets visually.
  if (injectedThisCall && window.$ && $.fn.niceSelect) {
    $('.margin-theme-row select').niceSelect();
  }
  return injectedAny && allDone;
};

// Propagate data-theme + data-mode from the host page into the editor iframes
// so [data-theme="X"][data-mode="Y"] rules in pad-editor.css apply inside.
const propagateTheme = () => {
  try {
    const theme = document.documentElement.getAttribute('data-theme');
    const mode = document.documentElement.getAttribute('data-mode');
    if (!theme) return;
    const setOn = (doc) => {
      if (!doc) return;
      const apply = (el) => {
        if (!el) return;
        el.setAttribute('data-theme', theme);
        if (mode) el.setAttribute('data-mode', mode);
      };
      apply(doc.documentElement);
      apply(doc.getElementById && doc.getElementById('outerdocbody'));
      apply(doc.getElementById && doc.getElementById('innerdocbody'));
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
  // Also re-apply if theme/mode is changed at runtime
  new MutationObserver(propagateTheme).observe(document.documentElement, {
    attributes: true, attributeFilter: ['data-theme', 'data-mode'],
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
