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

  describe('triage', function () {
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

    it('classifies a single-file finding with remediationHint as fix-now', function () {
      const {classify} = require('../../../node/utils/releaseReview/triage');
      const buckets = classify([
        mkFinding({remediationHint: 'replace == with ===', severity: 'high'}),
      ]);
      assert.equal(buckets.fixNow.length, 1);
      assert.equal(buckets.issue.length, 0);
      assert.equal(buckets.suppress.length, 0);
    });

    it('classifies a category=lint finding as suppress', function () {
      const {classify} = require('../../../node/utils/releaseReview/triage');
      const buckets = classify([mkFinding({category: 'lint'})]);
      assert.equal(buckets.suppress.length, 1);
    });

    it('classifies medium-severity tool finding without remediation as suppress', function () {
      const {classify} = require('../../../node/utils/releaseReview/triage');
      const buckets = classify([mkFinding({severity: 'medium', source: 'semgrep'})]);
      assert.equal(buckets.suppress.length, 1);
    });

    it('classifies a high-severity AI finding without remediation as issue (needs design)', function () {
      const {classify} = require('../../../node/utils/releaseReview/triage');
      const buckets = classify([mkFinding({severity: 'high', source: 'auth-sessions'})]);
      assert.equal(buckets.issue.length, 1);
    });

    it('returns disjoint buckets summing to input length', function () {
      const {classify} = require('../../../node/utils/releaseReview/triage');
      const findings = [
        mkFinding({fingerprint: 'a'.repeat(64), category: 'lint'}),
        mkFinding({fingerprint: 'b'.repeat(64), severity: 'high', remediationHint: 'fix it'}),
        mkFinding({fingerprint: 'c'.repeat(64), severity: 'high', source: 'pad-changeset'}),
      ];
      const buckets = classify(findings);
      assert.equal(
        buckets.fixNow.length + buckets.issue.length + buckets.suppress.length,
        findings.length,
      );
    });
  });

  describe('runDir', function () {
    const tmpBase = path.join(FIXTURE_DIR, '_tmp-runs');

    beforeEach(function () {
      if (fs.existsSync(tmpBase)) fs.rmSync(tmpBase, {recursive: true});
      fs.mkdirSync(tmpBase, {recursive: true});
    });
    after(function () {
      if (fs.existsSync(tmpBase)) fs.rmSync(tmpBase, {recursive: true});
    });

    it('generates run-id format run-YYYY-MM-DD-N starting at 1', function () {
      const {nextRunId} = require('../../../node/utils/releaseReview/runDir');
      const id = nextRunId(tmpBase, '2026-05-09');
      assert.equal(id, 'run-2026-05-09-1');
    });

    it('increments N when same-day runs already exist', function () {
      const {nextRunId} = require('../../../node/utils/releaseReview/runDir');
      fs.mkdirSync(path.join(tmpBase, 'run-2026-05-09-1'));
      fs.mkdirSync(path.join(tmpBase, 'run-2026-05-09-2'));
      const id = nextRunId(tmpBase, '2026-05-09');
      assert.equal(id, 'run-2026-05-09-3');
    });

    it('starts at 1 for a new day even if older days exist', function () {
      const {nextRunId} = require('../../../node/utils/releaseReview/runDir');
      fs.mkdirSync(path.join(tmpBase, 'run-2026-05-08-5'));
      const id = nextRunId(tmpBase, '2026-05-09');
      assert.equal(id, 'run-2026-05-09-1');
    });

    it('ensureRunDir creates the dir and returns the absolute path', function () {
      const {ensureRunDir} = require('../../../node/utils/releaseReview/runDir');
      const p = ensureRunDir(tmpBase, 'run-2026-05-09-1');
      assert.equal(fs.existsSync(p), true);
      assert.equal(p, path.join(tmpBase, 'run-2026-05-09-1'));
    });
  });

  describe('summary', function () {
    const tmpDir = path.join(FIXTURE_DIR, '_tmp-summary');
    beforeEach(function () {
      if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, {recursive: true});
      fs.mkdirSync(tmpDir, {recursive: true});
    });
    after(function () {
      if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, {recursive: true});
    });

    it('writes a markdown file with run-id, version, counts, decisions', function () {
      const {writeSummary} = require('../../../node/utils/releaseReview/summary');
      const out = path.join(tmpDir, '2.8.0-summary.md');
      writeSummary({
        runId: 'run-2026-05-09-1',
        version: '2.8.0',
        counts: {high: 2, medium: 5},
        decisions: [
          {fingerprint: 'a'.repeat(64), action: 'fix', file: 'src/x.ts', ruleId: 'r1'},
          {fingerprint: 'b'.repeat(64), action: 'wontfix', file: 'src/y.ts', ruleId: 'r2', rationale: 'not exploitable'},
          {fingerprint: 'c'.repeat(64), action: 'issue', file: 'src/z.ts', ruleId: 'r3', issueUrl: 'https://github.com/ether/etherpad-lite/issues/9999'},
        ],
      }, out);
      const md = fs.readFileSync(out, 'utf8');
      assert.match(md, /run-2026-05-09-1/);
      assert.match(md, /2\.8\.0/);
      assert.match(md, /high.*2/i);
      assert.match(md, /medium.*5/i);
      assert.match(md, /src\/x\.ts/);
      assert.match(md, /not exploitable/);
      assert.match(md, /issues\/9999/);
    });

    it('handles a session with no decisions', function () {
      const {writeSummary} = require('../../../node/utils/releaseReview/summary');
      const out = path.join(tmpDir, 'empty-summary.md');
      writeSummary({
        runId: 'run-2026-05-09-2',
        version: '2.8.0',
        counts: {high: 0, medium: 0},
        decisions: [],
      }, out);
      const md = fs.readFileSync(out, 'utf8');
      assert.match(md, /no decisions/i);
    });
  });

  describe('cli', function () {
    const {execFileSync} = require('child_process');
    const tmpDir = path.join(FIXTURE_DIR, '_tmp-cli');
    const cliPath = path.join(__dirname, '..', '..', '..', 'node', 'utils', 'releaseReview', 'cli.ts');

    beforeEach(function () {
      if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, {recursive: true});
      fs.mkdirSync(tmpDir, {recursive: true});
    });
    after(function () {
      if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, {recursive: true});
    });

    const runCli = (args: string[]): string =>
      execFileSync('node', ['--import', 'tsx', cliPath, ...args], {encoding: 'utf8'});

    it('next-run-id prints expected id for empty base dir', function () {
      this.timeout(15000);
      const out = runCli(['next-run-id', tmpDir]).trim();
      assert.match(out, /^run-\d{4}-\d{2}-\d{2}-1$/);
    });

    it('aggregate reads runDir JSONs, writes merged.json with severity floor applied', function () {
      this.timeout(15000);
      const runDir = path.join(tmpDir, 'run-2026-05-09-1');
      fs.mkdirSync(runDir);
      fs.writeFileSync(path.join(runDir, 'tool-findings.json'), JSON.stringify([
        {source: 'semgrep', fingerprint: 'a'.repeat(64), severity: 'high', category: 'cve', file: 'x.ts', line: 1, ruleId: 'r1', message: 'm1'},
        {source: 'semgrep', fingerprint: 'b'.repeat(64), severity: 'low', category: 'lint', file: 'x.ts', line: 2, ruleId: 'r2', message: 'm2'},
      ]));
      const supPath = path.join(tmpDir, 'sup.yml');
      fs.writeFileSync(supPath, 'findings: []\n');
      runCli(['aggregate', runDir, supPath, 'medium', '/']);
      const merged = JSON.parse(fs.readFileSync(path.join(runDir, 'merged.json'), 'utf8'));
      assert.equal(merged.length, 1);
      assert.equal(merged[0].severity, 'high');
    });

    it('aggregate enriches findings without fingerprint by computing from file content', function () {
      this.timeout(15000);
      const runDir = path.join(tmpDir, 'run-2026-05-09-2');
      fs.mkdirSync(runDir);
      // Use the sample fixture as the "source under review".
      const sampleAbs = path.join(FIXTURE_DIR, 'sample-source.ts');
      fs.writeFileSync(path.join(runDir, 'auth-sessions.json'), JSON.stringify({
        findings: [
          {source: 'auth-sessions', severity: 'high', category: 'bug', file: sampleAbs, line: 6, ruleId: 'auth-sessions.token-equality', message: 'token == null'},
        ],
      }));
      const supPath = path.join(tmpDir, 'sup-empty.yml');
      fs.writeFileSync(supPath, 'findings: []\n');
      runCli(['aggregate', runDir, supPath, 'medium', '/']);
      const merged = JSON.parse(fs.readFileSync(path.join(runDir, 'merged.json'), 'utf8'));
      assert.equal(merged.length, 1);
      assert.match(merged[0].fingerprint, /^[0-9a-f]{64}$/);
    });

    it('aggregate resolves repo-relative file paths against repoRoot', function () {
      this.timeout(15000);
      const runDir = path.join(tmpDir, 'run-2026-05-09-3');
      fs.mkdirSync(runDir);
      // Use a relative path that requires repoRoot resolution.
      const fakeRepoRoot = FIXTURE_DIR;
      const relPath = 'sample-source.ts';  // exists at FIXTURE_DIR/sample-source.ts
      fs.writeFileSync(path.join(runDir, 'auth-sessions.json'), JSON.stringify({
        findings: [
          {source: 'auth-sessions', severity: 'high', category: 'bug', file: relPath, line: 6, ruleId: 'auth-sessions.x', message: 'm'},
        ],
      }));
      const supPath = path.join(tmpDir, 'sup-rel.yml');
      fs.writeFileSync(supPath, 'findings: []\n');
      runCli(['aggregate', runDir, supPath, 'medium', fakeRepoRoot]);
      const merged = JSON.parse(fs.readFileSync(path.join(runDir, 'merged.json'), 'utf8'));
      assert.equal(merged.length, 1);
      // Fingerprint should be computed from real file content.
      // Compare to a known fingerprint we can derive directly.
      const {computeFingerprint} = require('../../../node/utils/releaseReview/fingerprint');
      const lines = fs.readFileSync(path.join(fakeRepoRoot, relPath), 'utf8').split('\n');
      const expected = computeFingerprint('auth-sessions.x', relPath, 6, lines);
      assert.equal(merged[0].fingerprint, expected);
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
