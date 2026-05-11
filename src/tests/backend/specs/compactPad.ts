'use strict';

import {generateJWTToken} from "../common";

const assert = require('assert').strict;
const common = require('../common');
const padManager = require('../../../node/db/PadManager');
const api = require('../../../node/db/API');
const settings = require('../../../node/utils/Settings');

// Coverage for the compactPad API endpoint added in #6194.
// The underlying Cleanup logic is tested where it lives; these tests just
// verify the public-API wiring and argument handling.
describe(__filename, function () {
  let padId: string;
  let agent: any;
  let cleanupEnabledBackup: boolean;

  before(async function () {
    agent = await common.init();
    // compactPad is gated on cleanup.enabled (matches the admin/Cleanup
    // path). Enable it for the duration of these tests and restore after,
    // and add a focused spec below that asserts the gate.
    cleanupEnabledBackup = settings.cleanup.enabled;
    settings.cleanup.enabled = true;
  });

  after(function () { settings.cleanup.enabled = cleanupEnabledBackup; });

  beforeEach(async function () {
    padId = common.randomString();
    assert(!await padManager.doesPadExist(padId));
  });

  describe('API.compactPad()', function () {
    it('collapses all history when keepRevisions is omitted', async function () {
      const pad = await padManager.getPad(padId);
      await pad.appendText('marker-alpha\n');
      await pad.appendText('marker-beta\n');
      await pad.appendText('marker-gamma\n');
      const before = pad.getHeadRevisionNumber();
      assert.ok(before >= 3, `expected at least 3 revs, got ${before}`);

      const result = await api.compactPad(padId);
      assert.deepStrictEqual(result, {ok: true, mode: 'all'});

      // Reload: the compacted pad lands at head<=1 (matches the shape
      // `copyPadWithoutHistory` produces). The content survives — we
      // don't assert byte-exact equality because Cleanup.deleteAllRevisions
      // goes through copyPadWithoutHistory twice and may adjust trailing
      // whitespace; what we care about is that the author-written content
      // is still there.
      const reloaded = await padManager.getPad(padId);
      assert.ok(reloaded.getHeadRevisionNumber() <= 1,
          `expected head<=1, got ${reloaded.getHeadRevisionNumber()}`);
      const text = reloaded.atext.text;
      assert.ok(text.includes('marker-alpha'), 'alpha content preserved');
      assert.ok(text.includes('marker-beta'), 'beta content preserved');
      assert.ok(text.includes('marker-gamma'), 'gamma content preserved');
    });

    it('keeps only the last N revisions when keepRevisions is a number',
        async function () {
          const pad = await padManager.getPad(padId);
          for (let i = 0; i < 6; i++) await pad.appendText(`keep-line-${i}\n`);
          const before = pad.getHeadRevisionNumber();

          const result = await api.compactPad(padId, 2);
          assert.strictEqual(result.mode, 'keepLast');
          assert.strictEqual(result.keepRevisions, 2);

          const reloaded = await padManager.getPad(padId);
          assert.ok(reloaded.getHeadRevisionNumber() <= before);
          // Content survives — whitespace normalization from the twin-copy
          // roundtrip is ignored, we just check the actual text markers.
          for (let i = 0; i < 6; i++) {
            assert.ok(reloaded.atext.text.includes(`keep-line-${i}`),
                `line ${i} survived compaction`);
          }
        });

    it('rejects negative keepRevisions', async function () {
      const pad = await padManager.getPad(padId);
      await pad.appendText('content\n');
      await assert.rejects(
          () => api.compactPad(padId, -1),
          /keepRevisions must be a non-negative integer/);
    });

    it('rejects non-numeric keepRevisions', async function () {
      const pad = await padManager.getPad(padId);
      await pad.appendText('content\n');
      await assert.rejects(
          // @ts-ignore - deliberately passing an invalid type
          () => api.compactPad(padId, 'nope'),
          /keepRevisions must be a non-negative integer/);
    });

    it('rejects fractional keepRevisions', async function () {
      // 2.5 is finite + non-negative but not an integer — Cleanup.deleteRevisions
      // does revision-index arithmetic that assumes integer math, so we
      // reject at the API boundary instead of letting it silently misbehave.
      const pad = await padManager.getPad(padId);
      await pad.appendText('content\n');
      await assert.rejects(
          () => api.compactPad(padId, 2.5),
          /keepRevisions must be a non-negative integer/);
    });

    it('refuses to run when cleanup.enabled is false', async function () {
      // Mirrors the admin/Cleanup-socket path: same opt-in, same surface
      // area. An operator who hasn't reviewed the cleanup story shouldn't
      // get destructive compaction by default just because the API is
      // exposed.
      settings.cleanup.enabled = false;
      try {
        const pad = await padManager.getPad(padId);
        await pad.appendText('content\n');
        await assert.rejects(
            () => api.compactPad(padId),
            /cleanup\.enabled = true/);
      } finally {
        settings.cleanup.enabled = true;
      }
    });
  });

  // Verifies the APIHandler dispatch wiring — i.e. that `keepRevisions`
  // travels from the URL query string to the API function under the
  // right argument name. This catches regressions where the handler's
  // version map gets renamed without updating the function signature.
  describe('HTTP API dispatch (1.3.1)', function () {
    it('passes keepRevisions from query string into compactPad', async function () {
      const pad = await padManager.getPad(padId);
      for (let i = 0; i < 5; i++) await pad.appendText(`http-line-${i}\n`);

      const res = await agent.get(
          `/api/1.3.1/compactPad?padID=${padId}&keepRevisions=2`)
          .set('authorization', await generateJWTToken())
          .expect(200)
          .expect('Content-Type', /json/);

      assert.strictEqual(res.body.code, 0, JSON.stringify(res.body));
      assert.strictEqual(res.body.data.mode, 'keepLast');
      assert.strictEqual(res.body.data.keepRevisions, 2);
    });

    it('collapses all history when keepRevisions is absent from URL', async function () {
      const pad = await padManager.getPad(padId);
      for (let i = 0; i < 3; i++) await pad.appendText(`http-all-${i}\n`);

      const res = await agent.get(`/api/1.3.1/compactPad?padID=${padId}`)
          .set('authorization', await generateJWTToken())
          .expect(200)
          .expect('Content-Type', /json/);

      assert.strictEqual(res.body.code, 0, JSON.stringify(res.body));
      assert.deepStrictEqual(res.body.data, {ok: true, mode: 'all'});
    });
  });

  // Coverage for the per-instance bulk-compaction loop in
  // bin/compactAllPads.ts. We test the exported `runCompactAll` against
  // an in-memory CompactAllApi rather than spawning the script + fetch,
  // so we don't have to stand up an APIKEY-auth path. The CLI shell that
  // wires fetch+APIKEY is a thin adapter; the loop logic — error
  // tolerance, dry-run, keep-last, tally — is what regresses, and that
  // is what this exercises.
  describe('runCompactAll (bin/compactAllPads loop)', function () {
    // Imported lazily so module-load-time side effects in compactAllPads
    // (require.main check) don't trip on the mocha runner.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const {runCompactAll, parseArgs} = require('../../../../bin/compactAllPads');

    const silent = {info: () => {}, error: () => {}};

    // Builds a stub api that walks the same pad set as a real instance
    // would, with optional per-pad failure injection.
    type StubFails = {list?: boolean; count?: Set<string>; compact?: Set<string>};
    const makeApi = (padIds: string[], fails: StubFails = {}) => {
      const counts = new Map<string, number>();
      padIds.forEach((p) => counts.set(p, 5));
      return {
        async listAllPads() {
          if (fails.list) throw new Error('boom');
          return padIds.slice();
        },
        async getRevisionsCount(padId: string) {
          if (fails.count?.has(padId)) throw new Error('count-boom');
          const c = counts.get(padId);
          if (c == null) throw new Error('unknown pad');
          return c;
        },
        async compactPad(padId: string, keepRevisions: number | null) {
          if (fails.compact?.has(padId)) throw new Error('compact-boom');
          counts.set(padId, keepRevisions == null ? 0 : Math.min(counts.get(padId)!, keepRevisions));
        },
      };
    };

    it('parses --keep / --dry-run / no args', function () {
      assert.deepStrictEqual(parseArgs([]),
          {keepRevisions: null, dryRun: false});
      assert.deepStrictEqual(parseArgs(['--dry-run']),
          {keepRevisions: null, dryRun: true});
      assert.deepStrictEqual(parseArgs(['--keep', '3']),
          {keepRevisions: 3, dryRun: false});
      assert.deepStrictEqual(parseArgs(['--keep', '3', '--dry-run']),
          {keepRevisions: 3, dryRun: true});
    });

    it('rejects --keep with non-integer / negative / unknown args', function () {
      assert.strictEqual(parseArgs(['--keep', 'abc']), null);
      assert.strictEqual(parseArgs(['--keep', '-1']), null);
      assert.strictEqual(parseArgs(['--unknown']), null);
    });

    it('compacts every pad and tallies before/after revisions', async function () {
      const api = makeApi(['p-a', 'p-b', 'p-c']);
      const report = await runCompactAll(api,
          {keepRevisions: null, dryRun: false}, silent);
      assert.strictEqual(report.total, 3);
      assert.strictEqual(report.ok, 3);
      assert.strictEqual(report.failed, 0);
      // Each pad starts with 5 (head) → 6 revisions; collapse → 0 head, 1 rev.
      assert.strictEqual(report.totalRevsBefore, 18);
      assert.strictEqual(report.totalRevsAfter, 3);
    });

    it('honours --keep N by passing it through to compactPad', async function () {
      const seen: Array<[string, number | null]> = [];
      const api = {
        async listAllPads() { return ['p-x', 'p-y']; },
        async getRevisionsCount() { return 5; },
        async compactPad(padId: string, k: number | null) { seen.push([padId, k]); },
      };
      const report = await runCompactAll(api,
          {keepRevisions: 2, dryRun: false}, silent);
      assert.strictEqual(report.ok, 2);
      assert.deepStrictEqual(seen, [['p-x', 2], ['p-y', 2]]);
    });

    it('--dry-run does not call compactPad', async function () {
      let compactCalls = 0;
      const api = {
        async listAllPads() { return ['p-1', 'p-2']; },
        async getRevisionsCount() { return 4; },
        async compactPad() { compactCalls++; },
      };
      const report = await runCompactAll(api,
          {keepRevisions: null, dryRun: true}, silent);
      assert.strictEqual(compactCalls, 0);
      assert.strictEqual(report.ok, 0);
      assert.strictEqual(report.failed, 0);
      assert.strictEqual(report.totalRevsBefore, 10); // 2 pads × (4+1)
      assert.strictEqual(report.totalRevsAfter, 0);
    });

    it('keeps going when one pad fails to compact', async function () {
      const api = makeApi(['ok-1', 'broken', 'ok-2'],
          {compact: new Set(['broken'])});
      const report = await runCompactAll(api,
          {keepRevisions: null, dryRun: false}, silent);
      assert.strictEqual(report.total, 3);
      assert.strictEqual(report.ok, 2);
      assert.strictEqual(report.failed, 1);
    });

    it('keeps going when one pad fails the pre-flight count', async function () {
      const api = makeApi(['ok-1', 'broken'], {count: new Set(['broken'])});
      const report = await runCompactAll(api,
          {keepRevisions: null, dryRun: false}, silent);
      assert.strictEqual(report.ok, 1);
      assert.strictEqual(report.failed, 1);
    });

    it('reports listAllPads failure without iterating', async function () {
      const api = makeApi(['a', 'b', 'c'], {list: true});
      const report = await runCompactAll(api,
          {keepRevisions: null, dryRun: false}, silent);
      assert.strictEqual(report.total, 0);
      assert.strictEqual(report.failed, 1);
      assert.strictEqual(report.ok, 0);
    });

    it('handles an empty instance', async function () {
      const api = makeApi([]);
      const report = await runCompactAll(api,
          {keepRevisions: null, dryRun: false}, silent);
      assert.deepStrictEqual(report,
          {total: 0, ok: 0, failed: 0, totalRevsBefore: 0, totalRevsAfter: 0});
    });

    // Plumbs the loop through the real /api/1.3.1/compactPad endpoint so
    // we know the CLI's `cliApi` shape doesn't lie about its contract.
    // Auth is JWT (matching the test agent) rather than APIKEY; the
    // CLI path is otherwise identical.
    it('end-to-end against the real HTTP handler', async function () {
      const padA = common.randomString();
      const padB = common.randomString();
      const padObjA = await padManager.getPad(padA);
      const padObjB = await padManager.getPad(padB);
      for (let i = 0; i < 4; i++) await padObjA.appendText(`a-${i}\n`);
      for (let i = 0; i < 4; i++) await padObjB.appendText(`b-${i}\n`);
      const beforeA = padObjA.getHeadRevisionNumber();
      const beforeB = padObjB.getHeadRevisionNumber();
      assert.ok(beforeA >= 4 && beforeB >= 4);

      const httpApi = {
        async listAllPads() {
          // Only act on the pads this test created — the test DB is shared
          // across describes, so other specs may have left pads behind.
          return [padA, padB];
        },
        async getRevisionsCount(padId: string) {
          const r = await agent.get(
              `/api/1.3.1/getRevisionsCount?padID=${padId}`)
              .set('authorization', await generateJWTToken())
              .expect(200);
          if (r.body.code !== 0) throw new Error(JSON.stringify(r.body));
          return r.body.data.revisions;
        },
        async compactPad(padId: string, keepRevisions: number | null) {
          const url = keepRevisions == null
            ? `/api/1.3.1/compactPad?padID=${padId}`
            : `/api/1.3.1/compactPad?padID=${padId}&keepRevisions=${keepRevisions}`;
          const r = await agent.get(url)
              .set('authorization', await generateJWTToken())
              .expect(200);
          if (r.body.code !== 0) throw new Error(JSON.stringify(r.body));
        },
      };

      const report = await runCompactAll(httpApi,
          {keepRevisions: null, dryRun: false}, silent);
      assert.strictEqual(report.total, 2);
      assert.strictEqual(report.ok, 2);
      assert.strictEqual(report.failed, 0);

      // Both pads collapsed to head<=1.
      const reA = await padManager.getPad(padA);
      const reB = await padManager.getPad(padB);
      assert.ok(reA.getHeadRevisionNumber() <= 1);
      assert.ok(reB.getHeadRevisionNumber() <= 1);
    });
  });

  // Coverage for the staleness-gated bulk loop in
  // bin/compactStalePads.ts (issue #7642). Same pattern as the
  // compactAllPads tests above: stub api + `now` injection so we don't
  // need real wall-clock drift, plus one end-to-end run through the
  // real /api/1.3.1/getLastEdited + compactPad endpoints to prove the
  // CLI's adapter shape doesn't lie.
  describe('runCompactStale (bin/compactStalePads loop)', function () {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const {runCompactStale, parseArgs} =
        require('../../../../bin/compactStalePads');

    const silent = {info: () => {}, error: () => {}};
    const NOW = 1_700_000_000_000;
    const day = 24 * 60 * 60 * 1000;
    const fixedNow = () => NOW;

    type StubFails = {
      list?: boolean;
      lastEdited?: Set<string>;
      count?: Set<string>;
      compact?: Set<string>;
    };
    const makeApi = (
      pads: Array<{id: string, ageDays: number}>, fails: StubFails = {},
    ) => {
      const counts = new Map<string, number>();
      const ages = new Map<string, number>();
      pads.forEach((p) => {
        counts.set(p.id, 5);
        ages.set(p.id, NOW - p.ageDays * day);
      });
      return {
        async listAllPads() {
          if (fails.list) throw new Error('boom');
          return pads.map((p) => p.id);
        },
        async getLastEdited(padId: string) {
          if (fails.lastEdited?.has(padId)) throw new Error('lastEdited-boom');
          const t = ages.get(padId);
          if (t == null) throw new Error('unknown pad');
          return t;
        },
        async getRevisionsCount(padId: string) {
          if (fails.count?.has(padId)) throw new Error('count-boom');
          const c = counts.get(padId);
          if (c == null) throw new Error('unknown pad');
          return c;
        },
        async compactPad(padId: string, keepRevisions: number | null) {
          if (fails.compact?.has(padId)) throw new Error('compact-boom');
          counts.set(padId,
              keepRevisions == null ? 0 : Math.min(counts.get(padId)!, keepRevisions));
        },
      };
    };

    it('parses --older-than / --keep / --dry-run', function () {
      assert.deepStrictEqual(parseArgs(['--older-than', '90']),
          {olderThanDays: 90, keepRevisions: null, dryRun: false});
      assert.deepStrictEqual(parseArgs(['--older-than', '30', '--keep', '50']),
          {olderThanDays: 30, keepRevisions: 50, dryRun: false});
      assert.deepStrictEqual(
          parseArgs(['--older-than', '7', '--keep', '10', '--dry-run']),
          {olderThanDays: 7, keepRevisions: 10, dryRun: true});
    });

    it('rejects missing / invalid --older-than and unknown args', function () {
      assert.strictEqual(parseArgs([]), null);
      assert.strictEqual(parseArgs(['--keep', '10']), null);
      assert.strictEqual(parseArgs(['--older-than', 'abc']), null);
      assert.strictEqual(parseArgs(['--older-than', '-1']), null);
      assert.strictEqual(parseArgs(['--older-than', '7', '--unknown']), null);
    });

    it('only compacts pads older than the cutoff', async function () {
      const compacted: string[] = [];
      const api = {
        async listAllPads() { return ['fresh', 'stale-a', 'stale-b']; },
        async getLastEdited(padId: string) {
          if (padId === 'fresh') return NOW - 5 * day;
          return NOW - 120 * day;
        },
        async getRevisionsCount() { return 3; },
        async compactPad(padId: string) { compacted.push(padId); },
      };
      const report = await runCompactStale(api,
          {olderThanDays: 90, keepRevisions: null, dryRun: false},
          silent, fixedNow);
      assert.strictEqual(report.total, 3);
      assert.strictEqual(report.stale, 2);
      assert.strictEqual(report.skippedFresh, 1);
      assert.strictEqual(report.ok, 2);
      assert.deepStrictEqual(compacted.sort(), ['stale-a', 'stale-b']);
    });

    it('honours --keep N for stale pads', async function () {
      const seen: Array<[string, number | null]> = [];
      const api = {
        async listAllPads() { return ['p1', 'p2']; },
        async getLastEdited() { return NOW - 200 * day; },
        async getRevisionsCount() { return 5; },
        async compactPad(padId: string, k: number | null) {
          seen.push([padId, k]);
        },
      };
      const report = await runCompactStale(api,
          {olderThanDays: 90, keepRevisions: 3, dryRun: false},
          silent, fixedNow);
      assert.strictEqual(report.ok, 2);
      assert.deepStrictEqual(seen, [['p1', 3], ['p2', 3]]);
    });

    it('--dry-run does not call compactPad on stale pads', async function () {
      let compactCalls = 0;
      const api = {
        async listAllPads() { return ['old-1', 'old-2', 'fresh']; },
        async getLastEdited(padId: string) {
          return padId === 'fresh' ? NOW - 1 * day : NOW - 365 * day;
        },
        async getRevisionsCount() { return 4; },
        async compactPad() { compactCalls++; },
      };
      const report = await runCompactStale(api,
          {olderThanDays: 90, keepRevisions: null, dryRun: true},
          silent, fixedNow);
      assert.strictEqual(compactCalls, 0);
      assert.strictEqual(report.stale, 2);
      assert.strictEqual(report.skippedFresh, 1);
      assert.strictEqual(report.totalRevsBefore, 10); // 2 stale × (4+1)
      assert.strictEqual(report.totalRevsAfter, 0);
    });

    it('keeps going when one stale pad fails to compact', async function () {
      const api = makeApi(
          [{id: 'ok-1', ageDays: 100}, {id: 'broken', ageDays: 200},
            {id: 'ok-2', ageDays: 365}],
          {compact: new Set(['broken'])});
      const report = await runCompactStale(api,
          {olderThanDays: 90, keepRevisions: null, dryRun: false},
          silent, fixedNow);
      assert.strictEqual(report.stale, 3);
      assert.strictEqual(report.ok, 2);
      assert.strictEqual(report.failed, 1);
    });

    it('counts a getLastEdited failure as a failure but keeps going',
        async function () {
          const api = makeApi(
              [{id: 'a', ageDays: 100}, {id: 'unreadable', ageDays: 0},
                {id: 'b', ageDays: 200}],
              {lastEdited: new Set(['unreadable'])});
          const report = await runCompactStale(api,
              {olderThanDays: 90, keepRevisions: null, dryRun: false},
              silent, fixedNow);
          assert.strictEqual(report.total, 3);
          assert.strictEqual(report.stale, 2);
          assert.strictEqual(report.ok, 2);
          assert.strictEqual(report.failed, 1);
        });

    it('reports listAllPads failure without iterating', async function () {
      const api = makeApi([{id: 'a', ageDays: 100}], {list: true});
      const report = await runCompactStale(api,
          {olderThanDays: 90, keepRevisions: null, dryRun: false},
          silent, fixedNow);
      assert.strictEqual(report.total, 0);
      assert.strictEqual(report.failed, 1);
    });

    it('handles an empty instance', async function () {
      const api = makeApi([]);
      const report = await runCompactStale(api,
          {olderThanDays: 90, keepRevisions: null, dryRun: false},
          silent, fixedNow);
      assert.strictEqual(report.total, 0);
      assert.strictEqual(report.stale, 0);
      assert.strictEqual(report.ok, 0);
      assert.strictEqual(report.failed, 0);
    });

    it('handles an instance where every pad is fresh', async function () {
      const api = makeApi(
          [{id: 'a', ageDays: 1}, {id: 'b', ageDays: 5}]);
      const report = await runCompactStale(api,
          {olderThanDays: 90, keepRevisions: null, dryRun: false},
          silent, fixedNow);
      assert.strictEqual(report.stale, 0);
      assert.strictEqual(report.skippedFresh, 2);
      assert.strictEqual(report.ok, 0);
    });

    it('skips a pad that gets edited between selection and compaction',
        async function () {
          // Two getLastEdited calls per pad: the first-pass selection,
          // and the right-before-compact recheck. We answer "old" the
          // first time and "fresh" the second to simulate an edit
          // landing during the run.
          const calls: Record<string, number> = {p1: 0, p2: 0};
          let compactCalls = 0;
          const api = {
            async listAllPads() { return ['p1', 'p2']; },
            async getLastEdited(padId: string) {
              calls[padId]++;
              if (padId === 'p1' && calls.p1 === 2) return NOW - 1 * day;
              return NOW - 200 * day;
            },
            async getRevisionsCount() { return 4; },
            async compactPad() { compactCalls++; },
          };
          const report = await runCompactStale(api,
              {olderThanDays: 90, keepRevisions: null, dryRun: false},
              silent, fixedNow);
          assert.strictEqual(report.total, 2);
          assert.strictEqual(report.stale, 1, 'p1 reclassified to fresh');
          assert.strictEqual(report.skippedFresh, 1);
          assert.strictEqual(report.ok, 1);
          assert.strictEqual(compactCalls, 1);
        });

    it('counts a getLastEdited recheck failure as a failure', async function () {
      let compactCalls = 0;
      const callCount: Record<string, number> = {p1: 0};
      const api = {
        async listAllPads() { return ['p1']; },
        async getLastEdited(padId: string) {
          callCount[padId]++;
          if (callCount[padId] === 2) throw new Error('recheck-boom');
          return NOW - 200 * day;
        },
        async getRevisionsCount() { return 5; },
        async compactPad() { compactCalls++; },
      };
      const report = await runCompactStale(api,
          {olderThanDays: 90, keepRevisions: null, dryRun: false},
          silent, fixedNow);
      assert.strictEqual(report.failed, 1);
      assert.strictEqual(report.ok, 0);
      assert.strictEqual(compactCalls, 0);
    });

    it('--older-than 0 treats every pad as stale', async function () {
      const api = makeApi(
          [{id: 'a', ageDays: 0}, {id: 'b', ageDays: 0}]);
      const report = await runCompactStale(api,
          {olderThanDays: 0, keepRevisions: null, dryRun: false},
          silent, fixedNow);
      assert.strictEqual(report.stale, 2);
      assert.strictEqual(report.ok, 2);
    });

    // Plumbs the loop through the real /api/1.3.1/getLastEdited +
    // compactPad endpoints so we know the CLI's adapter shape doesn't
    // lie about its contract. Two pads, both old (the test instance
    // wall-clock is "now"), with --older-than 0 to force both stale.
    it('end-to-end against the real HTTP handler', async function () {
      const padA = common.randomString();
      const padB = common.randomString();
      const padObjA = await padManager.getPad(padA);
      const padObjB = await padManager.getPad(padB);
      for (let i = 0; i < 4; i++) await padObjA.appendText(`a-${i}\n`);
      for (let i = 0; i < 4; i++) await padObjB.appendText(`b-${i}\n`);
      const beforeA = padObjA.getHeadRevisionNumber();
      const beforeB = padObjB.getHeadRevisionNumber();
      assert.ok(beforeA >= 4 && beforeB >= 4);

      const allowed = new Set([padA, padB]);
      const httpApi = {
        // Scope to just the pads this test created — the test DB is
        // shared across describes.
        async listAllPads() { return [padA, padB]; },
        async getLastEdited(padId: string) {
          const r = await agent.get(
              `/api/1.3.1/getLastEdited?padID=${padId}`)
              .set('authorization', await generateJWTToken())
              .expect(200);
          if (r.body.code !== 0) throw new Error(JSON.stringify(r.body));
          return r.body.data.lastEdited;
        },
        async getRevisionsCount(padId: string) {
          const r = await agent.get(
              `/api/1.3.1/getRevisionsCount?padID=${padId}`)
              .set('authorization', await generateJWTToken())
              .expect(200);
          if (r.body.code !== 0) throw new Error(JSON.stringify(r.body));
          return r.body.data.revisions;
        },
        async compactPad(padId: string, keepRevisions: number | null) {
          assert.ok(allowed.has(padId));
          const url = keepRevisions == null
            ? `/api/1.3.1/compactPad?padID=${padId}`
            : `/api/1.3.1/compactPad?padID=${padId}&keepRevisions=${keepRevisions}`;
          const r = await agent.get(url)
              .set('authorization', await generateJWTToken())
              .expect(200);
          if (r.body.code !== 0) throw new Error(JSON.stringify(r.body));
        },
      };

      // --older-than 0 → cutoff == now → both freshly-edited test pads
      // are >= cutoff and considered stale.
      const report = await runCompactStale(httpApi,
          {olderThanDays: 0, keepRevisions: null, dryRun: false}, silent);
      assert.strictEqual(report.total, 2);
      assert.strictEqual(report.stale, 2);
      assert.strictEqual(report.ok, 2);
      assert.strictEqual(report.failed, 0);

      const reA = await padManager.getPad(padA);
      const reB = await padManager.getPad(padB);
      assert.ok(reA.getHeadRevisionNumber() <= 1);
      assert.ok(reB.getHeadRevisionNumber() <= 1);
    });
  });
});
