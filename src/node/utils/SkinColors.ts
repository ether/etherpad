'use strict';

// Toolbar background colors that the colibris skin variants resolve to.
// Mirrors --bg-color in src/static/skins/colibris/src/pad-variants.css so
// that <meta name="theme-color"> can match the toolbar on first paint
// (before client-side JS runs).
const TOOLBAR_COLORS: {[variant: string]: string} = {
  'super-light-toolbar': '#ffffff',
  'light-toolbar': '#f2f3f4',
  'dark-toolbar': '#576273',
  'super-dark-toolbar': '#485365',
};

const DEFAULT_TOOLBAR_COLOR = '#ffffff';

// The colibris dark-mode auto-switch in pad.ts forces the toolbar variant to
// 'super-dark-toolbar' regardless of what skinVariants was configured with, so
// the prefers-color-scheme: dark theme-color meta must always resolve to that
// color rather than to whatever dark variant the operator picked.
export const DARK_MODE_TOOLBAR_COLOR = TOOLBAR_COLORS['super-dark-toolbar'];

// The toolbar color that the configured skinVariants resolves to (the color
// the user sees before any client-side dark-mode override). Returns the first
// recognized *-toolbar token; falls back to the default light color.
export const configuredToolbarColor = (skinVariants: string | undefined | null) => {
  const tokens = (skinVariants || '').split(/\s+/).filter(Boolean);
  for (const token of tokens) {
    const color = TOOLBAR_COLORS[token];
    if (color) return color;
  }
  return DEFAULT_TOOLBAR_COLOR;
};

module.exports = {DARK_MODE_TOOLBAR_COLOR, configuredToolbarColor};
