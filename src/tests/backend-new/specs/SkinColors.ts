import {toolbarThemeColors, configuredToolbarColor} from "../../../node/utils/SkinColors";
import {expect, describe, it} from "vitest";

describe('SkinColors.toolbarThemeColors', function () {
  it('returns defaults for an empty skinVariants string', function () {
    expect(toolbarThemeColors('')).toEqual({light: '#ffffff', dark: '#485365'});
  });

  it('returns defaults for null/undefined', function () {
    expect(toolbarThemeColors(null)).toEqual({light: '#ffffff', dark: '#485365'});
    expect(toolbarThemeColors(undefined)).toEqual({light: '#ffffff', dark: '#485365'});
  });

  it('maps super-light-toolbar to white', function () {
    expect(toolbarThemeColors('super-light-toolbar super-light-editor light-background').light)
        .toBe('#ffffff');
  });

  it('maps light-toolbar to its --light-color value', function () {
    expect(toolbarThemeColors('light-toolbar').light).toBe('#f2f3f4');
  });

  it('maps dark-toolbar to its --dark-color value', function () {
    expect(toolbarThemeColors('dark-toolbar').dark).toBe('#576273');
  });

  it('maps super-dark-toolbar to its --super-dark-color value', function () {
    expect(toolbarThemeColors('super-dark-toolbar').dark).toBe('#485365');
  });

  it('ignores unrelated tokens', function () {
    const colors = toolbarThemeColors('super-light-toolbar full-width-editor light-background');
    expect(colors.light).toBe('#ffffff');
    expect(colors.dark).toBe('#485365');
  });

  it('handles a mix of light and dark toolbar tokens', function () {
    const colors = toolbarThemeColors('light-toolbar dark-toolbar');
    expect(colors.light).toBe('#f2f3f4');
    expect(colors.dark).toBe('#576273');
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
