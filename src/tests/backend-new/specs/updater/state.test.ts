import {describe, it, expect, beforeEach} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {loadState, saveState} from '../../../../node/updater/state';
import {EMPTY_STATE} from '../../../../node/updater/types';

let dir: string;
const statePath = () => path.join(dir, 'update-state.json');

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'updater-state-'));
});

describe('loadState', () => {
  it('returns empty state when file does not exist', async () => {
    const s = await loadState(statePath());
    expect(s).toEqual(EMPTY_STATE);
  });

  it('round-trips a saved state', async () => {
    const s = {...EMPTY_STATE, lastCheckAt: '2026-04-25T00:00:00Z'};
    await saveState(statePath(), s);
    const loaded = await loadState(statePath());
    expect(loaded.lastCheckAt).toBe('2026-04-25T00:00:00Z');
  });

  it('returns empty state when file is corrupt', async () => {
    await fs.writeFile(statePath(), 'not json');
    const s = await loadState(statePath());
    expect(s).toEqual(EMPTY_STATE);
  });

  it('returns empty state when schemaVersion is unknown', async () => {
    await fs.writeFile(statePath(), JSON.stringify({schemaVersion: 999}));
    const s = await loadState(statePath());
    expect(s).toEqual(EMPTY_STATE);
  });

  it('returns empty state when email is null', async () => {
    // Regression: typeof null === 'object', so a hand-edited file with email:null
    // would have passed an earlier shape check and crashed downstream consumers.
    const broken = {...EMPTY_STATE, email: null};
    await fs.writeFile(statePath(), JSON.stringify(broken));
    const s = await loadState(statePath());
    expect(s).toEqual(EMPTY_STATE);
  });

  it('returns empty state when latest is an array', async () => {
    const broken = {...EMPTY_STATE, latest: []};
    await fs.writeFile(statePath(), JSON.stringify(broken));
    const s = await loadState(statePath());
    expect(s).toEqual(EMPTY_STATE);
  });

  it('returns empty state when latest is missing required subfields', async () => {
    // Regression: top-level shape passed earlier validation but downstream code
    // calls .trim() / semver parsing on latest.version → crash on bad input.
    const broken = {...EMPTY_STATE, latest: {version: 1}};
    await fs.writeFile(statePath(), JSON.stringify(broken));
    const s = await loadState(statePath());
    expect(s).toEqual(EMPTY_STATE);
  });

  it('returns empty state when vulnerableBelow entries miss threshold', async () => {
    const broken = {...EMPTY_STATE, vulnerableBelow: [{announcedBy: 'v1.0.0'}]};
    await fs.writeFile(statePath(), JSON.stringify(broken));
    const s = await loadState(statePath());
    expect(s).toEqual(EMPTY_STATE);
  });

  it('returns empty state when vulnerableBelow.threshold is non-string', async () => {
    const broken = {...EMPTY_STATE, vulnerableBelow: [{announcedBy: 'v1', threshold: 123}]};
    await fs.writeFile(statePath(), JSON.stringify(broken));
    const s = await loadState(statePath());
    expect(s).toEqual(EMPTY_STATE);
  });

  it('returns empty state when email subfield is wrong type', async () => {
    const broken = {...EMPTY_STATE, email: {severeAt: 0, vulnerableAt: null, vulnerableNewReleaseTag: null}};
    await fs.writeFile(statePath(), JSON.stringify(broken));
    const s = await loadState(statePath());
    expect(s).toEqual(EMPTY_STATE);
  });

  it('accepts a fully-typed latest payload', async () => {
    const good = {
      ...EMPTY_STATE,
      latest: {
        version: '2.7.2',
        tag: 'v2.7.2',
        body: 'release notes',
        publishedAt: '2026-04-25T00:00:00Z',
        htmlUrl: 'https://example.invalid/r/v2.7.2',
        prerelease: false,
      },
    };
    await fs.writeFile(statePath(), JSON.stringify(good));
    const s = await loadState(statePath());
    expect(s.latest?.version).toBe('2.7.2');
  });
});

describe('saveState', () => {
  it('writes atomically (no partial file on crash simulation)', async () => {
    // We cannot easily simulate a crash, but we can verify the write went via a tmp file
    // by checking only one file ends up in the dir.
    await saveState(statePath(), EMPTY_STATE);
    const entries = await fs.readdir(dir);
    expect(entries).toEqual(['update-state.json']);
  });

  it('creates the directory if missing', async () => {
    const nested = path.join(dir, 'nested', 'deep', 'update-state.json');
    await saveState(nested, EMPTY_STATE);
    const data = JSON.parse(await fs.readFile(nested, 'utf8'));
    expect(data.schemaVersion).toBe(1);
  });
});

describe('Tier 2 state extensions', () => {
  it('EMPTY_STATE carries an idle execution block, bootCount 0, no lastResult', () => {
    expect(EMPTY_STATE.execution).toEqual({status: 'idle'});
    expect(EMPTY_STATE.bootCount).toBe(0);
    expect(EMPTY_STATE.lastResult).toBeNull();
  });

  it('loadState backfills missing Tier 2 fields on a Tier 1 file', async () => {
    // Hand-write a Tier 1 state file (no execution / bootCount / lastResult).
    await fs.writeFile(statePath(), JSON.stringify({
      schemaVersion: 1,
      lastCheckAt: '2026-05-01T00:00:00Z',
      lastEtag: 'W/"abc"',
      latest: null,
      vulnerableBelow: [],
      email: {severeAt: null, vulnerableAt: null, vulnerableNewReleaseTag: null},
    }));
    const state = await loadState(statePath());
    expect(state.execution).toEqual({status: 'idle'});
    expect(state.bootCount).toBe(0);
    expect(state.lastResult).toBeNull();
    // Tier 1 fields preserved.
    expect(state.lastCheckAt).toBe('2026-05-01T00:00:00Z');
    expect(state.lastEtag).toBe('W/"abc"');
  });

  it('rejects a malformed execution block by resetting to EMPTY_STATE', async () => {
    await fs.writeFile(statePath(), JSON.stringify({
      schemaVersion: 1, lastCheckAt: null, lastEtag: null, latest: null,
      vulnerableBelow: [],
      email: {severeAt: null, vulnerableAt: null, vulnerableNewReleaseTag: null},
      execution: 'not-an-object',
    }));
    const state = await loadState(statePath());
    expect(state).toEqual(EMPTY_STATE);
  });

  it('rejects an unknown execution status by resetting to EMPTY_STATE', async () => {
    await fs.writeFile(statePath(), JSON.stringify({
      schemaVersion: 1, lastCheckAt: null, lastEtag: null, latest: null,
      vulnerableBelow: [],
      email: {severeAt: null, vulnerableAt: null, vulnerableNewReleaseTag: null},
      execution: {status: 'totally-bogus'},
    }));
    const state = await loadState(statePath());
    expect(state).toEqual(EMPTY_STATE);
  });

  it('rejects a non-numeric bootCount by resetting to EMPTY_STATE', async () => {
    await fs.writeFile(statePath(), JSON.stringify({
      schemaVersion: 1, lastCheckAt: null, lastEtag: null, latest: null,
      vulnerableBelow: [],
      email: {severeAt: null, vulnerableAt: null, vulnerableNewReleaseTag: null},
      execution: {status: 'idle'},
      bootCount: 'one',
    }));
    const state = await loadState(statePath());
    expect(state).toEqual(EMPTY_STATE);
  });

  it('round-trips a pending-verification execution', async () => {
    const s = {
      ...EMPTY_STATE,
      execution: {
        status: 'pending-verification' as const,
        targetTag: 'v2.7.3',
        fromSha: 'abc123',
        deadlineAt: '2026-05-08T10:00:00Z',
      },
      bootCount: 1,
    };
    await saveState(statePath(), s);
    const loaded = await loadState(statePath());
    expect(loaded.execution.status).toBe('pending-verification');
    expect(loaded.bootCount).toBe(1);
  });

  it('round-trips a non-null lastResult', async () => {
    const s = {
      ...EMPTY_STATE,
      lastResult: {
        targetTag: 'v2.7.3', fromSha: 'abc',
        outcome: 'verified' as const, reason: null,
        at: '2026-05-08T10:00:00Z',
      },
    };
    await saveState(statePath(), s);
    const loaded = await loadState(statePath());
    expect(loaded.lastResult?.outcome).toBe('verified');
  });
});
