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

  describe('suppression', function () {
    const valid = path.join(FIXTURE_DIR, 'suppression-valid.yml');
    const malformed = path.join(FIXTURE_DIR, 'suppression-malformed.yml');
    const badShape = path.join(FIXTURE_DIR, 'suppression-bad-shape.yml');

    it('loads a well-formed file', function () {
      const {loadSuppression} = require('../../../node/utils/releaseReview/suppression');
      const entries = loadSuppression(valid);
      assert.equal(entries.length, 2);
      assert.equal(entries[0].status, 'wontfix');
      assert.equal(entries[1].targetRelease, '2.9.0');
    });

    it('returns empty array if file does not exist', function () {
      const {loadSuppression} = require('../../../node/utils/releaseReview/suppression');
      const entries = loadSuppression(path.join(FIXTURE_DIR, 'does-not-exist.yml'));
      assert.deepEqual(entries, []);
    });

    it('throws on malformed YAML with file path in error', function () {
      const {loadSuppression} = require('../../../node/utils/releaseReview/suppression');
      assert.throws(() => loadSuppression(malformed), (err: Error) => {
        return err.message.includes('suppression-malformed.yml');
      });
    });

    it('throws on entries missing required fields', function () {
      const {loadSuppression} = require('../../../node/utils/releaseReview/suppression');
      assert.throws(() => loadSuppression(badShape), /fingerprint/);
    });

    it('throws on deferred entry without targetRelease', function () {
      const tmp = path.join(FIXTURE_DIR, '_tmp-deferred-no-target.yml');
      fs.writeFileSync(tmp, [
        'findings:',
        '  - fingerprint: cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
        '    status: deferred',
        '    decidedAt: 2026-05-09',
        '    decidedInRun: run-x',
        '    rationale: "no target"',
      ].join('\n'));
      try {
        const {loadSuppression} = require('../../../node/utils/releaseReview/suppression');
        assert.throws(() => loadSuppression(tmp), /targetRelease/);
      } finally {
        fs.unlinkSync(tmp);
      }
    });

    it('appends an entry to a fresh file with header preserved', function () {
      const tmp = path.join(FIXTURE_DIR, '_tmp-append.yml');
      fs.writeFileSync(tmp, '# header comment\n\nfindings: []\n');
      try {
        const {appendSuppression} = require('../../../node/utils/releaseReview/suppression');
        appendSuppression(tmp, {
          fingerprint: 'd'.repeat(64),
          status: 'accepted-risk',
          decidedAt: '2026-05-09',
          decidedInRun: 'run-x',
          rationale: 'baseline',
        });
        const written = fs.readFileSync(tmp, 'utf8');
        assert.match(written, /# header comment/);
        assert.match(written, /accepted-risk/);
        assert.match(written, /baseline/);
        const {loadSuppression} = require('../../../node/utils/releaseReview/suppression');
        assert.equal(loadSuppression(tmp).length, 1);
      } finally {
        fs.unlinkSync(tmp);
      }
    });
  });
});
