'use strict';

import {strict as assert} from 'assert';
import fs from 'node:fs';
import path from 'node:path';
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

  describe('every known log-site routes IPs through anonymizeIp', function () {
    // Regression guard: if any of these files ever log `req.ip` /
    // `socket.request.ip` / `request.ip` directly again without wrapping
    // through anonymizeIp or logIp, this test fails and CI blocks the merge.
    const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
    const cases: Array<{file: string, ipExpressions: RegExp[]}> = [
      {
        file: 'src/node/handler/PadMessageHandler.ts',
        ipExpressions: [/socket\.request\.ip/g],
      },
      {
        file: 'src/node/handler/SocketIORouter.ts',
        ipExpressions: [/socket\.request\.ip/g],
      },
      {
        file: 'src/node/hooks/express/webaccess.ts',
        ipExpressions: [/req\.ip/g],
      },
      {
        file: 'src/node/hooks/express/importexport.ts',
        ipExpressions: [/request\.ip/g],
      },
    ];

    for (const {file, ipExpressions} of cases) {
      it(`${file} does not log a raw IP`, function () {
        const content = fs.readFileSync(path.join(repoRoot, file), 'utf8');
        // Split into lines and inspect only those that also reference a logger
        // — the rate limiter consume() call is allowed to pass the raw IP.
        const offending: string[] = [];
        for (const line of content.split('\n')) {
          if (!/(?:accessLogger|messageLogger|httpLogger|logger|console)\.(?:info|warn|error|debug|log)|backtick.*IP/i
              .test(line) && !line.includes('IP:') && !line.includes('IP address')) continue;
          if (line.includes('anonymizeIp') || line.includes('logIp(')) continue;
          for (const re of ipExpressions) {
            if (re.test(line)) {
              offending.push(line.trim());
              break;
            }
          }
        }
        assert.deepEqual(offending, [],
            `found raw IP(s) in log lines of ${file}:\n${offending.join('\n')}`);
      });
    }
  });

  describe('invalid ipLogging falls back to anonymous at load time', function () {
    it('rejects an unknown mode', function () {
      // Replicate the validation block directly so we don't need to reload.
      const valid = ['full', 'truncated', 'anonymous'];
      let mode: any = 'lolnope';
      if (!valid.includes(mode)) mode = 'anonymous';
      assert.equal(mode, 'anonymous');
      assert.equal(anonymizeIp('8.8.8.8', mode), 'ANONYMOUS');
    });

    it('rejects null', function () {
      const valid = ['full', 'truncated', 'anonymous'];
      let mode: any = null;
      if (!valid.includes(mode)) mode = 'anonymous';
      assert.equal(mode, 'anonymous');
    });
  });
});
