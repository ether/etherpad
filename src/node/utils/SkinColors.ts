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

const DEFAULT_LIGHT = '#ffffff';
const DEFAULT_DARK = '#485365';

export const toolbarThemeColors = (skinVariants: string | undefined | null) => {
  const tokens = (skinVariants || '').split(/\s+/).filter(Boolean);
  let light = DEFAULT_LIGHT;
  let dark = DEFAULT_DARK;
  for (const token of tokens) {
    const color = TOOLBAR_COLORS[token];
    if (!color) continue;
    if (token.includes('dark')) dark = color;
    else light = color;
  }
  return {light, dark};
};

module.exports = {toolbarThemeColors};
