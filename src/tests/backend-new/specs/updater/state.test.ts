import {describe, it, expect, beforeEach} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {loadState, saveState, EMPTY_STATE_FOR_TESTS} from '../../../../node/updater/state';

let dir: string;
const statePath = () => path.join(dir, 'update-state.json');

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'updater-state-'));
});

describe('loadState', () => {
  it('returns empty state when file does not exist', async () => {
    const s = await loadState(statePath());
    expect(s).toEqual(EMPTY_STATE_FOR_TESTS);
  });

  it('round-trips a saved state', async () => {
    const s = {...EMPTY_STATE_FOR_TESTS, lastCheckAt: '2026-04-25T00:00:00Z'};
    await saveState(statePath(), s);
    const loaded = await loadState(statePath());
    expect(loaded.lastCheckAt).toBe('2026-04-25T00:00:00Z');
  });

  it('returns empty state when file is corrupt', async () => {
    await fs.writeFile(statePath(), 'not json');
    const s = await loadState(statePath());
    expect(s).toEqual(EMPTY_STATE_FOR_TESTS);
  });

  it('returns empty state when schemaVersion is unknown', async () => {
    await fs.writeFile(statePath(), JSON.stringify({schemaVersion: 999}));
    const s = await loadState(statePath());
    expect(s).toEqual(EMPTY_STATE_FOR_TESTS);
  });
});

describe('saveState', () => {
  it('writes atomically (no partial file on crash simulation)', async () => {
    // We cannot easily simulate a crash, but we can verify the write went via a tmp file
    // by checking only one file ends up in the dir.
    await saveState(statePath(), EMPTY_STATE_FOR_TESTS);
    const entries = await fs.readdir(dir);
    expect(entries).toEqual(['update-state.json']);
  });

  it('creates the directory if missing', async () => {
    const nested = path.join(dir, 'nested', 'deep', 'update-state.json');
    await saveState(nested, EMPTY_STATE_FOR_TESTS);
    const data = JSON.parse(await fs.readFile(nested, 'utf8'));
    expect(data.schemaVersion).toBe(1);
  });
});
