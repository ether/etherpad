'use strict';

import {strict as assert} from 'assert';
import settings from '../../../node/utils/Settings';
import {anonymizeIp} from '../../../node/utils/anonymizeIp';

describe(__filename, function () {
  const backup = {ipLogging: settings.ipLogging, disableIPlogging: settings.disableIPlogging};

  afterEach(function () {
    settings.ipLogging = backup.ipLogging;
    settings.disableIPlogging = backup.disableIPlogging;
  });

  describe('settings.ipLogging is honoured by anonymizeIp', function () {
    it('anonymous mode redacts a concrete IPv4', function () {
      settings.ipLogging = 'anonymous';
      assert.equal(anonymizeIp('8.8.8.8', settings.ipLogging), 'ANONYMOUS');
    });

    it('full mode passes the IP through unchanged', function () {
      settings.ipLogging = 'full';
      assert.equal(anonymizeIp('8.8.8.8', settings.ipLogging), '8.8.8.8');
    });

    it('truncated mode zeros the last v4 octet', function () {
      settings.ipLogging = 'truncated';
      assert.equal(anonymizeIp('8.8.8.8', settings.ipLogging), '8.8.8.0');
    });

    it('truncated mode keeps the first /48 of a v6 address', function () {
      settings.ipLogging = 'truncated';
      assert.equal(anonymizeIp('2001:db8::1', settings.ipLogging), '2001:db8::');
    });
  });

  describe('disableIPlogging → ipLogging deprecation shim', function () {
    // Replicates the shim block from Settings.ts::reloadSettings so we can
    // assert the mapping without rebooting the whole server in this spec.
    const applyShim = (parsed: Record<string, any>) => {
      if (parsed != null && 'disableIPlogging' in parsed && !('ipLogging' in parsed)) {
        settings.ipLogging = parsed.disableIPlogging ? 'anonymous' : 'full';
      }
    };

    it('maps disableIPlogging=true to ipLogging=anonymous', function () {
      settings.ipLogging = 'full';
      applyShim({disableIPlogging: true});
      assert.equal(settings.ipLogging, 'anonymous');
    });

    it('maps disableIPlogging=false to ipLogging=full', function () {
      settings.ipLogging = 'anonymous';
      applyShim({disableIPlogging: false});
      assert.equal(settings.ipLogging, 'full');
    });

    it('leaves ipLogging alone when the operator set both', function () {
      settings.ipLogging = 'truncated';
      applyShim({disableIPlogging: true, ipLogging: 'truncated'});
      assert.equal(settings.ipLogging, 'truncated');
    });

    it('does nothing when neither key is present', function () {
      settings.ipLogging = 'anonymous';
      applyShim({});
      assert.equal(settings.ipLogging, 'anonymous');
    });
  });
});
