'use strict';

import settings from '../../../node/utils/Settings';

export const assertPluginCatalogEnabled = () => {
  if (!settings.privacy.pluginCatalog) {
    throw new Error(
      'Plugin catalog disabled by privacy.pluginCatalog=false (see PRIVACY.md)'
    );
  }
};
