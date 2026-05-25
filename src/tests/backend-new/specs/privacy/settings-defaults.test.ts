import {describe, it, expect} from 'vitest';
import settings from '../../../../node/utils/Settings.js';

describe('privacy settings defaults', () => {
  it('privacy.updateCheck defaults to true', () => {
    expect(settings.privacy.updateCheck).toBe(true);
  });

  it('privacy.pluginCatalog defaults to true', () => {
    expect(settings.privacy.pluginCatalog).toBe(true);
  });
});
