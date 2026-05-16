'use strict';

import {describe, it, expect} from 'vitest';
import {
  checkEngineCompatibility,
  EngineIncompatibleError,
} from '../../../static/js/pluginfw/pluginEngineCheck';

describe('pluginEngineCheck', () => {
  describe('checkEngineCompatibility', () => {
    it('returns compatible when plugin declares no engines.node', () => {
      expect(checkEngineCompatibility(undefined, 'v22.13.0').compatible).toBe(true);
    });

    it('returns compatible when the current Node satisfies the range', () => {
      expect(checkEngineCompatibility('>=22.13.0', 'v22.13.0').compatible).toBe(true);
      expect(checkEngineCompatibility('>=22.13.0', 'v25.1.0').compatible).toBe(true);
    });

    it('returns incompatible when the current Node is below the required range', () => {
      const result = checkEngineCompatibility('>=25.0.0', 'v22.13.0');
      expect(result.compatible).toBe(false);
      if (!result.compatible) {
        expect(result.required).toBe('>=25.0.0');
        expect(result.current).toBe('22.13.0');
      }
    });

    it('strips the leading "v" from process.version-style strings', () => {
      const result = checkEngineCompatibility('>=25.0.0', 'v22.13.0');
      expect(result.compatible).toBe(false);
      if (!result.compatible) expect(result.current).not.toMatch(/^v/);
    });

    it('treats malformed engines strings as compatible (do not block install)', () => {
      // If the plugin's engines field is garbage we should not block — let
      // live-plugin-manager handle it. The whole point of this preflight is
      // to give a useful message; if we can't parse the range, fall through.
      expect(checkEngineCompatibility('not-a-range', 'v22.13.0').compatible).toBe(true);
    });
  });

  describe('EngineIncompatibleError', () => {
    it('carries a stable code and the plugin name', () => {
      const err = new EngineIncompatibleError('ep_test', '>=25.0.0', '22.13.0');
      expect(err.code).toBe('PLUGIN_REQUIRES_NEWER_ETHERPAD');
      expect(err.pluginName).toBe('ep_test');
      expect(err.required).toBe('>=25.0.0');
      expect(err.current).toBe('22.13.0');
    });

    it('produces a user-facing message that does not mention Node', () => {
      // Message reaches the admin UI. Per design, the admin is told to
      // upgrade Etherpad — Node is an implementation detail.
      const err = new EngineIncompatibleError('ep_test', '>=25.0.0', '22.13.0');
      expect(err.message).toMatch(/newer version of Etherpad/);
      expect(err.message.toLowerCase()).not.toMatch(/node/);
    });

    it('is an instance of Error', () => {
      const err = new EngineIncompatibleError('ep_test', '>=25.0.0', '22.13.0');
      expect(err).toBeInstanceOf(Error);
    });
  });
});
