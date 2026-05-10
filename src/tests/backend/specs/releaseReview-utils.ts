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

  describe('aggregate', function () {
    const mkFinding = (over: any) => ({
      source: 'semgrep',
      fingerprint: 'x'.repeat(64),
      severity: 'medium',
      category: 'bug',
      file: 'src/a.ts',
      line: 1,
      ruleId: 'r',
      message: 'm',
      ...over,
    });

    it('drops findings below severity floor', function () {
      const {aggregate} = require('../../../node/utils/releaseReview/aggregate');
      const out = aggregate(
        [[mkFinding({severity: 'low'}), mkFinding({severity: 'medium', fingerprint: 'a'.repeat(64)})]],
        [],
        'medium',
      );
      assert.equal(out.length, 1);
      assert.equal(out[0].severity, 'medium');
    });

    it('drops findings whose fingerprint appears in suppression with wontfix or accepted-risk', function () {
      const {aggregate} = require('../../../node/utils/releaseReview/aggregate');
      const fp = 'a'.repeat(64);
      const out = aggregate(
        [[mkFinding({fingerprint: fp, severity: 'high'})]],
        [{fingerprint: fp, status: 'wontfix', decidedAt: 'd', decidedInRun: 'r', rationale: 'r'}],
        'medium',
      );
      assert.equal(out.length, 0);
    });

    it('keeps deferred findings but annotates them', function () {
      const {aggregate} = require('../../../node/utils/releaseReview/aggregate');
      const fp = 'a'.repeat(64);
      const out = aggregate(
        [[mkFinding({fingerprint: fp, severity: 'high'})]],
        [{fingerprint: fp, status: 'deferred', decidedAt: 'd', decidedInRun: 'old-run', rationale: 'r', targetRelease: '2.9.0'}],
        'medium',
      );
      assert.equal(out.length, 1);
      assert.equal(out[0].firstSeen, 'old-run');
    });

    it('dedupes by fingerprint, keeping highest severity', function () {
      const {aggregate} = require('../../../node/utils/releaseReview/aggregate');
      const fp = 'a'.repeat(64);
      const out = aggregate(
        [
          [mkFinding({fingerprint: fp, severity: 'medium', source: 'semgrep'})],
          [mkFinding({fingerprint: fp, severity: 'high', source: 'auth-sessions'})],
        ],
        [],
        'medium',
      );
      assert.equal(out.length, 1);
      assert.equal(out[0].severity, 'high');
      assert.match(out[0].source, /semgrep/);
      assert.match(out[0].source, /auth-sessions/);
    });

    it('sorts by severity (high first) then category (cve > bug > perf > supply-chain)', function () {
      const {aggregate} = require('../../../node/utils/releaseReview/aggregate');
      const out = aggregate(
        [[
          mkFinding({fingerprint: 'a'.repeat(64), severity: 'medium', category: 'bug'}),
          mkFinding({fingerprint: 'b'.repeat(64), severity: 'high', category: 'perf'}),
          mkFinding({fingerprint: 'c'.repeat(64), severity: 'high', category: 'cve'}),
          mkFinding({fingerprint: 'd'.repeat(64), severity: 'medium', category: 'cve'}),
        ]],
        [],
        'medium',
      );
      assert.deepEqual(out.map((f: any) => f.fingerprint[0]), ['c', 'b', 'd', 'a']);
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
