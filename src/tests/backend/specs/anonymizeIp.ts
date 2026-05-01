'use strict';

import {strict as assert} from 'assert';
import {anonymizeIp} from '../../../node/utils/anonymizeIp';

describe(__filename, function () {
  describe('anonymous mode', function () {
    it('replaces v4 with ANONYMOUS', function () {
      assert.equal(anonymizeIp('1.2.3.4', 'anonymous'), 'ANONYMOUS');
    });
    it('replaces v6 with ANONYMOUS', function () {
      assert.equal(anonymizeIp('2001:db8::1', 'anonymous'), 'ANONYMOUS');
    });
  });

  describe('full mode', function () {
    it('passes v4 through unchanged', function () {
      assert.equal(anonymizeIp('1.2.3.4', 'full'), '1.2.3.4');
    });
    it('passes v6 through unchanged', function () {
      assert.equal(anonymizeIp('2001:db8::1', 'full'), '2001:db8::1');
    });
  });

  describe('truncated mode', function () {
    it('zeros the last octet of v4', function () {
      assert.equal(anonymizeIp('1.2.3.4', 'truncated'), '1.2.3.0');
    });
    it('keeps the first /48 of a compressed v6', function () {
      assert.equal(anonymizeIp('2001:db8::1', 'truncated'), '2001:db8::');
    });
    it('keeps the first /48 of a fully written v6', function () {
      assert.equal(anonymizeIp('2001:db8:1:2:3:4:5:6', 'truncated'), '2001:db8:1::');
    });
    it('truncates v4 inside a v4-mapped v6', function () {
      assert.equal(anonymizeIp('::ffff:1.2.3.4', 'truncated'), '::ffff:1.2.3.0');
    });
    it('returns ANONYMOUS for a non-IP string', function () {
      assert.equal(anonymizeIp('not-an-ip', 'truncated'), 'ANONYMOUS');
    });
  });

  describe('empty / null input', function () {
    for (const mode of ['full', 'truncated', 'anonymous'] as const) {
      it(`returns ANONYMOUS for null in ${mode} mode`, function () {
        assert.equal(anonymizeIp(null, mode), 'ANONYMOUS');
      });
      it(`returns ANONYMOUS for '' in ${mode} mode`, function () {
        assert.equal(anonymizeIp('', mode), 'ANONYMOUS');
      });
    }
  });
});
