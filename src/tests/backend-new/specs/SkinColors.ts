import {configuredToolbarColor} from "../../../node/utils/SkinColors";
import {expect, describe, it} from "vitest";

describe('SkinColors.configuredToolbarColor', function () {
  it('returns null for non-colibris skins so the meta is omitted', function () {
    expect(configuredToolbarColor('no-skin', 'super-light-toolbar')).toBeNull();
    expect(configuredToolbarColor(null, 'super-light-toolbar')).toBeNull();
    expect(configuredToolbarColor('custom-skin', 'dark-toolbar')).toBeNull();
  });

  it('returns the colibris default when no toolbar token is set', function () {
    expect(configuredToolbarColor('colibris', '')).toBe('#ffffff');
    expect(configuredToolbarColor('colibris', null)).toBe('#ffffff');
    expect(configuredToolbarColor('colibris', 'full-width-editor')).toBe('#ffffff');
  });

  it('maps each *-toolbar token to its colibris --bg-color', function () {
    expect(configuredToolbarColor('colibris', 'super-light-toolbar')).toBe('#ffffff');
    expect(configuredToolbarColor('colibris', 'light-toolbar')).toBe('#f2f3f4');
    expect(configuredToolbarColor('colibris', 'super-dark-toolbar')).toBe('#485365');
    expect(configuredToolbarColor('colibris', 'dark-toolbar')).toBe('#576273');
  });

  it('respects CSS source order when multiple toolbar tokens are present', function () {
    // pad-variants.css declares dark-toolbar last, so it wins on tie regardless of token order.
    expect(configuredToolbarColor('colibris', 'super-light-toolbar dark-toolbar')).toBe('#576273');
    expect(configuredToolbarColor('colibris', 'dark-toolbar super-light-toolbar')).toBe('#576273');
    // super-dark-toolbar precedes dark-toolbar in CSS, so dark wins when both are present.
    expect(configuredToolbarColor('colibris', 'super-dark-toolbar dark-toolbar')).toBe('#576273');
    // super-dark-toolbar wins over light-toolbar.
    expect(configuredToolbarColor('colibris', 'light-toolbar super-dark-toolbar')).toBe('#485365');
  });

  it('ignores unrelated tokens', function () {
    expect(configuredToolbarColor('colibris', 'super-light-toolbar full-width-editor light-background'))
        .toBe('#ffffff');
  });
});
