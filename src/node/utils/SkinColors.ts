'use strict';

// Toolbar background colors that the colibris skin variants resolve to.
// Mirrors --bg-color in src/static/skins/colibris/src/pad-variants.css. Only
// the colibris skin has a known mapping; for any other skin we cannot derive
// the toolbar color server-side and emit no theme-color meta.
//
// Order matters: when skinVariants contains multiple *-toolbar tokens the
// CSS cascade picks the rule defined last in pad-variants.css, so iterate in
// source order and let the last matching token win.
const TOOLBAR_COLORS_IN_CSS_ORDER: Array<[string, string]> = [
  ['super-light-toolbar', '#ffffff'],
  ['light-toolbar', '#f2f3f4'],
  ['super-dark-toolbar', '#485365'],
  ['dark-toolbar', '#576273'],
];

const COLIBRIS_DEFAULT_TOOLBAR_COLOR = '#ffffff';

// The toolbar color the user actually sees on first paint, derived from the
// configured skin and skinVariants. Returns null when the skin is unknown so
// callers can omit the meta rather than emit a misleading value.
export const configuredToolbarColor = (
  skinName: string | undefined | null,
  skinVariants: string | undefined | null,
): string | null => {
  if (skinName !== 'colibris') return null;
  const tokens = new Set((skinVariants || '').split(/\s+/).filter(Boolean));
  let color: string | null = null;
  for (const [variant, c] of TOOLBAR_COLORS_IN_CSS_ORDER) {
    if (tokens.has(variant)) color = c;
  }
  return color || COLIBRIS_DEFAULT_TOOLBAR_COLOR;
};
