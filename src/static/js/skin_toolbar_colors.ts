'use strict';

// Toolbar background colors that the colibris skin variants resolve to.
// Mirrors --bg-color in src/static/skins/colibris/src/pad-variants.css. Lives
// here (under static/js/) so both the browser bundle (skin_variants.ts) and
// the server-side EJS helper (node/utils/SkinColors.ts) can import it without
// duplication — a drift between client and server tables would silently
// reintroduce the "address bar disagrees with toolbar" bug.
//
// Order matters: when skinVariants contains multiple *-toolbar tokens the
// CSS cascade picks the rule defined last in pad-variants.css, so iterate in
// source order and let the last matching token win.
export const TOOLBAR_COLORS_IN_CSS_ORDER: ReadonlyArray<readonly [string, string]> = [
  ['super-light-toolbar', '#ffffff'],
  ['light-toolbar', '#f2f3f4'],
  ['super-dark-toolbar', '#485365'],
  ['dark-toolbar', '#576273'],
];

export const COLIBRIS_DEFAULT_TOOLBAR_COLOR = '#ffffff';

// Resolve the toolbar color for a set of skin-variant tokens. Pure data: no
// DOM, no Node APIs — safe to call from both server and client.
export const toolbarColorForTokens = (tokens: Iterable<string>): string => {
  const set = new Set(tokens);
  let color = COLIBRIS_DEFAULT_TOOLBAR_COLOR;
  for (const [variant, c] of TOOLBAR_COLORS_IN_CSS_ORDER) {
    if (set.has(variant)) color = c;
  }
  return color;
};
