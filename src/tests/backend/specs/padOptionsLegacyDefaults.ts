'use strict';

import {strict as assert} from 'assert';

describe(__filename, function () {
  // Replicates the shim block from Settings.ts::reloadSettings so we can
  // assert the mapping without rebooting the whole server in this spec.
  // Keep this in lockstep with the production block — if you change the
  // shim there, change it here too.
  const applyShim = (padOptions: any) => {
    if (padOptions != null && typeof padOptions === 'object' && !Array.isArray(padOptions)) {
      for (const key of ['userName', 'userColor']) {
        if (padOptions[key] === false) padOptions[key] = null;
      }
    }
    return padOptions;
  };

  describe('legacy padOptions.userName/userColor=false → null shim', function () {
    it('coerces userName=false to null', function () {
      const out = applyShim({userName: false});
      assert.strictEqual(out.userName, null);
    });

    it('coerces userColor=false to null', function () {
      const out = applyShim({userColor: false});
      assert.strictEqual(out.userColor, null);
    });

    it('coerces both legacy defaults in one pass', function () {
      const out = applyShim({userName: false, userColor: false});
      assert.strictEqual(out.userName, null);
      assert.strictEqual(out.userColor, null);
    });

    it('leaves an explicit string userName intact', function () {
      const out = applyShim({userName: 'Etherpad User'});
      assert.strictEqual(out.userName, 'Etherpad User');
    });

    it('leaves an explicit hex userColor intact', function () {
      const out = applyShim({userColor: '#ff9900'});
      assert.strictEqual(out.userColor, '#ff9900');
    });

    it('leaves null values untouched', function () {
      const out = applyShim({userName: null, userColor: null});
      assert.strictEqual(out.userName, null);
      assert.strictEqual(out.userColor, null);
    });

    it('does not affect other padOptions keys that legitimately use false', function () {
      // showChat:false, rtl:false, etc. are real, meaningful values — only
      // the two string options carry the legacy boolean sentinel.
      const out = applyShim({
        userName: false,
        userColor: false,
        showChat: false,
        rtl: false,
        useMonospaceFont: false,
      });
      assert.strictEqual(out.userName, null);
      assert.strictEqual(out.userColor, null);
      assert.strictEqual(out.showChat, false);
      assert.strictEqual(out.rtl, false);
      assert.strictEqual(out.useMonospaceFont, false);
    });

    it('does not coerce the string "false" — that is handled in the client guard', function () {
      // The server-side shim only normalizes the boolean sentinel from
      // legacy settings.json. URL-supplied or stringified "false" is
      // rejected by pad.ts::getParameters.userName/userColor callbacks.
      const out = applyShim({userName: 'false', userColor: 'false'});
      assert.strictEqual(out.userName, 'false');
      assert.strictEqual(out.userColor, 'false');
    });

    it('skips the shim if padOptions is null', function () {
      // storeSettings() overwrites settings.padOptions raw if settings.json
      // declares it as a non-object — the shim must not throw on that.
      assert.doesNotThrow(() => applyShim(null));
      assert.strictEqual(applyShim(null), null);
    });

    it('skips the shim if padOptions is a primitive', function () {
      assert.doesNotThrow(() => applyShim(false));
      assert.doesNotThrow(() => applyShim('not an object'));
      assert.doesNotThrow(() => applyShim(42));
    });

    it('skips the shim if padOptions is an array', function () {
      const arr: any = [false, false];
      assert.doesNotThrow(() => applyShim(arr));
      // Arrays pass through untouched — index 0/1 (numeric) are not coerced.
      assert.deepEqual(applyShim(arr), [false, false]);
    });
  });
});
