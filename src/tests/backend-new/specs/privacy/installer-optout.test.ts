import {describe, it, expect, beforeEach} from 'vitest';
import settings from '../../../../node/utils/Settings';
import {assertPluginCatalogEnabled} from '../../../../static/js/pluginfw/pluginCatalogGuard';

describe('Plugin catalog opt-out guard', () => {
  beforeEach(() => {
    settings.privacy.pluginCatalog = true;
  });

  it('throws tagged error when privacy.pluginCatalog is false', () => {
    settings.privacy.pluginCatalog = false;
    expect(() => assertPluginCatalogEnabled()).toThrow(
      /privacy\.pluginCatalog=false/
    );
  });

  it('does not throw when privacy.pluginCatalog is true', () => {
    settings.privacy.pluginCatalog = true;
    expect(() => assertPluginCatalogEnabled()).not.toThrow();
  });
});
