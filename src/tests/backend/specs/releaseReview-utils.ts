'use strict';

import {strict as assert} from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import {computeFingerprint} from '../../../node/utils/releaseReview/fingerprint';

const FIXTURE_DIR = path.join(__dirname, '..', 'fixtures', 'releaseReview');
const SAMPLE = path.join(FIXTURE_DIR, 'sample-source.ts');

const readLines = (file: string): string[] => fs.readFileSync(file, 'utf8').split('\n');

describe(__filename, function () {
  describe('computeFingerprint', function () {
    it('returns a 64-char lowercase hex sha256', function () {
      const lines = readLines(SAMPLE);
      const fp = computeFingerprint('rule.x', SAMPLE, 6, lines);
      assert.match(fp, /^[0-9a-f]{64}$/);
    });

    it('is stable when whitespace-only lines shift around the finding', function () {
      const lines = readLines(SAMPLE);
      const fpA = computeFingerprint('rule.x', SAMPLE, 6, lines);
      // Insert a blank line above the finding; renumber so the same logical
      // line content is now at line 7.
      const shifted = ['', ...lines];
      const fpB = computeFingerprint('rule.x', SAMPLE, 7, shifted);
      assert.equal(fpA, fpB);
    });

    it('changes when the finding line content changes', function () {
      const lines = readLines(SAMPLE);
      const fpA = computeFingerprint('rule.x', SAMPLE, 6, lines);
      // Mutate the finding line itself (the equality check).
      const mutated = lines.slice();
      mutated[5] = '  if (name === undefined) return \'hello stranger\';';
      const fpB = computeFingerprint('rule.x', SAMPLE, 6, mutated);
      assert.notEqual(fpA, fpB);
    });

    it('changes when the rule id changes', function () {
      const lines = readLines(SAMPLE);
      const fpA = computeFingerprint('rule.x', SAMPLE, 6, lines);
      const fpB = computeFingerprint('rule.y', SAMPLE, 6, lines);
      assert.notEqual(fpA, fpB);
    });

    it('changes when the file path changes', function () {
      const lines = readLines(SAMPLE);
      const fpA = computeFingerprint('rule.x', '/a/b.ts', 6, lines);
      const fpB = computeFingerprint('rule.x', '/a/c.ts', 6, lines);
      assert.notEqual(fpA, fpB);
    });

    it('handles edge: finding line near start of file (no 2 lines above)', function () {
      const lines = readLines(SAMPLE);
      const fp = computeFingerprint('rule.x', SAMPLE, 1, lines);
      assert.match(fp, /^[0-9a-f]{64}$/);
    });

    it('handles edge: finding line near end of file (no 2 lines below)', function () {
      const lines = readLines(SAMPLE);
      const fp = computeFingerprint('rule.x', SAMPLE, lines.length, lines);
      assert.match(fp, /^[0-9a-f]{64}$/);
    });
  });
});
