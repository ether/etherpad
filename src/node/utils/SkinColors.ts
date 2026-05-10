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
