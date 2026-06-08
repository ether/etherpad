'use strict';

import {toolbarColorForTokens} from '../../static/js/skin_toolbar_colors';

// The toolbar color the user actually sees on first paint, derived from the
// configured skin and skinVariants. Only the colibris skin has a known
// mapping (see src/static/js/skin_toolbar_colors). For any other skin we
// cannot derive the toolbar color server-side and return null so callers can
// omit the meta rather than emit a misleading value.
export const configuredToolbarColor = (
  skinName: string | undefined | null,
  skinVariants: string | undefined | null,
): string | null => {
  if (skinName !== 'colibris') return null;
  return toolbarColorForTokens((skinVariants || '').split(/\s+/).filter(Boolean));
};

// The toolbar color colibris auto-switches to on a dark-OS client (pad.ts
// forces 'super-dark-toolbar' when enableDarkMode is on and the system is in
// dark mode). Templates emit this in a `media="(prefers-color-scheme: dark)"`
// theme-color meta so iOS Safari — which colors the address bar at parse time
// and does not reliably repaint when JS mutates the tag later — picks the
// right color at first paint instead of staying on the light baseline
// (issue #7606). Returns null for non-colibris skins, matching
// configuredToolbarColor.
export const darkToolbarColor = (
  skinName: string | undefined | null,
): string | null => {
  if (skinName !== 'colibris') return null;
  return toolbarColorForTokens(['super-dark-toolbar']);
};
