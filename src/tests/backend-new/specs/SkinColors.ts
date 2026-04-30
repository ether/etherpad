import {DARK_MODE_TOOLBAR_COLOR, configuredToolbarColor} from "../../../node/utils/SkinColors";
import {expect, describe, it} from "vitest";

describe('SkinColors.DARK_MODE_TOOLBAR_COLOR', function () {
  it('matches the super-dark-toolbar color forced by client-side dark mode', function () {
    // pad.ts swaps to super-dark-toolbar on dark OS, so the dark theme-color
    // must match that fixed value, not whatever was configured in skinVariants.
    expect(DARK_MODE_TOOLBAR_COLOR).toBe('#485365');
  });
});

describe('SkinColors.configuredToolbarColor', function () {
  it('returns the default light color when no toolbar token is set', function () {
    expect(configuredToolbarColor('')).toBe('#ffffff');
    expect(configuredToolbarColor(null)).toBe('#ffffff');
    expect(configuredToolbarColor('full-width-editor')).toBe('#ffffff');
  });

  it('returns the configured light toolbar color', function () {
    expect(configuredToolbarColor('super-light-toolbar super-light-editor')).toBe('#ffffff');
    expect(configuredToolbarColor('light-toolbar')).toBe('#f2f3f4');
  });

  it('returns the configured dark toolbar color', function () {
    expect(configuredToolbarColor('dark-toolbar dark-editor')).toBe('#576273');
    expect(configuredToolbarColor('super-dark-toolbar')).toBe('#485365');
  });
});
