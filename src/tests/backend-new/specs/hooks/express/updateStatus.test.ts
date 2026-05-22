/**
 * End-to-end vitest coverage for the /api/version-status route.
 *
 * Harness: minimal Express app built by calling `expressCreateServer` directly
 * (same as production), then exercised via supertest. `loadState` is mocked so
 * tests control the "latest" version without touching the filesystem.
 * `PadManager` is mocked so pad-creation doesn't require a running database.
 * `AuthorManager` is mocked so token→authorID resolution doesn't require a DB.
 *
 * Author injection: `resolveRequestAuthor` reads the `token` cookie and calls
 * `authorManager.getAuthorId(token, user)`. Tests set `sessionAuthor` to
 * control which authorID the mock returns for the test token `t.alice`.
 * `null` means "anonymous" (getAuthorId returns null / empty for the token).
 */

import {describe, it, expect, vi, beforeAll, beforeEach, afterEach} from 'vitest';
import express from 'express';
import supertest from 'supertest';
import type {Express} from 'express';
import type {UpdateState} from '../../../../../node/updater/types';
import {EMPTY_STATE} from '../../../../../node/updater/types';
import {getEpVersion} from '../../../../../node/utils/Settings';
import {parseSemver} from '../../../../../node/updater/versionCompare';

// ---------------------------------------------------------------------------
// Module mocks — must appear before any import that transitively imports them.
// vi.mock() is hoisted by vitest ahead of all imports, so these factories run
// before updateStatus.ts is loaded and its own `import {loadState}` runs.
// ---------------------------------------------------------------------------

vi.mock('../../../../../node/updater/state', () => ({
  loadState: vi.fn(),
  saveState: vi.fn(),
}));

// The updater index is imported by updateStatus.ts for stateFilePath() and
// getDetectedInstallMethod(). Provide stubs so we don't boot the full updater.
vi.mock('../../../../../node/updater', () => ({
  stateFilePath: () => '/tmp/test-update-state.json',
  getDetectedInstallMethod: () => 'git',
}));

// AuthorManager is dynamically imported inside resolveRequestAuthor(). Stubbing
// it here lets tests control token→authorID resolution without a DB.
vi.mock('../../../../../node/db/AuthorManager', () => ({
  default: {
    getAuthorId: vi.fn(),
  },
}));

// PadManager is dynamically imported inside computeOutdated(). Stubbing it
// here lets us control pad existence and author-pool contents without a DB.
vi.mock('../../../../../node/db/PadManager', () => {
  const pads = new Map<string, any>();
  return {
    default: {
      isValidPadId: (id: string) => /^[^$]{1,50}$/.test(id),
      doesPadExist: async (id: string) => pads.has(id),
      getPad: async (id: string) => pads.get(id),
    },
    // Also expose the map for test setup via the named export __pads__.
    __pads__: pads,
  };
});

// ---------------------------------------------------------------------------
// Import the SUT *after* vi.mock declarations so the mocks take effect.
// ---------------------------------------------------------------------------

import * as stateModule from '../../../../../node/updater/state';
import * as authorManagerModule from '../../../../../node/db/AuthorManager';
import {
  expressCreateServer,
  _resetBadgeCacheForTests,
  _setBadgeCacheCapForTests,
} from '../../../../../node/hooks/express/updateStatus';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build the mocked state with optional `latest` field. */
const makeState = (latest: UpdateState['latest']): UpdateState => ({
  ...EMPTY_STATE,
  latest,
});

// Build fixtures relative to the actual current version so the test stays
// stable across release bumps. Hard-coded versions break every time the
// codebase rolls forward past the fixture (e.g. once 3.2.0 shipped, a
// MINOR_AHEAD pinned at "3.2.0" no longer counted as minor-behind).
const CUR = parseSemver(getEpVersion())!;
const v = (major: number, minor: number, patch: number) => `${major}.${minor}.${patch}`;

/** A fake ReleaseInfo for a version that is one minor ahead of current. */
const MINOR_AHEAD: UpdateState['latest'] = {
  version: v(CUR.major, CUR.minor + 1, 0),
  tag: `v${v(CUR.major, CUR.minor + 1, 0)}`,
  body: '',
  publishedAt: '2026-05-01T00:00:00Z',
  prerelease: false,
  htmlUrl: `https://github.com/ether/etherpad/releases/tag/v${v(CUR.major, CUR.minor + 1, 0)}`,
};

/** A fake ReleaseInfo that is only a patch ahead of current (no minor/major delta). */
const PATCH_AHEAD: UpdateState['latest'] = {
  version: v(CUR.major, CUR.minor, CUR.patch + 1),
  tag: `v${v(CUR.major, CUR.minor, CUR.patch + 1)}`,
  body: '',
  publishedAt: '2026-05-01T00:00:00Z',
  prerelease: false,
  htmlUrl: `https://github.com/ether/etherpad/releases/tag/v${v(CUR.major, CUR.minor, CUR.patch + 1)}`,
};

/** A fake ReleaseInfo that is behind current (current >= latest). */
const SAME_OR_BEHIND: UpdateState['latest'] = {
  version: v(Math.max(0, CUR.major - 1), 0, 0),
  tag: `v${v(Math.max(0, CUR.major - 1), 0, 0)}`,
  body: '',
  publishedAt: '2026-01-01T00:00:00Z',
  prerelease: false,
  htmlUrl: `https://github.com/ether/etherpad/releases/tag/v${v(Math.max(0, CUR.major - 1), 0, 0)}`,
};

// ---------------------------------------------------------------------------
// Test app setup
// ---------------------------------------------------------------------------

let app: Express;
let request: ReturnType<typeof supertest>;

/**
 * The author that `authorManager.getAuthorId` will return for the test token
 * `t.alice`. Tests set this before making a request. `null` means "anonymous"
 * (getAuthorId returns null/empty, so resolveRequestAuthor returns null).
 */
let sessionAuthor: string | null = null;

/** Fixed test token used in every request. The cookie name has no prefix in tests. */
const TEST_TOKEN = 't.alice';

beforeAll(() => {
  app = express();

  // Inject the test token cookie so resolveRequestAuthor() sees it.
  // The real cookie-parser middleware is not needed: we set req.cookies directly.
  app.use((req: any, _res, next) => {
    req.cookies = {token: TEST_TOKEN};
    next();
  });

  // Register the route under test. The hook signature is (hookName, {app, ...}, cb).
  expressCreateServer('expressCreateServer', {app, io: null, server: null, settings: null as any}, () => {});

  request = supertest(app);
});

beforeEach(() => {
  // Reset LRU cache and in-flight map so every test sees a cold cache.
  _resetBadgeCacheForTests();
  // Reset the session author to "anonymous" by default.
  sessionAuthor = null;
  // Reset the loadState spy so each test controls its own return value.
  vi.mocked(stateModule.loadState).mockReset();
  // Wire up the AuthorManager mock: return sessionAuthor (or null) for our test token.
  vi.mocked((authorManagerModule as any).default.getAuthorId).mockImplementation(
    async (token: string) => {
      if (token === TEST_TOKEN && sessionAuthor !== null) return sessionAuthor;
      return null;
    },
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helper to get the pad map from the mocked PadManager.
// ---------------------------------------------------------------------------

const getPadMap = async (): Promise<Map<string, any>> => {
  // Dynamic import returns the mock factory's return value.
  const mod: any = await import('../../../../../node/db/PadManager');
  return mod.__pads__ as Map<string, any>;
};

/** Create a minimal fake pad object with the given author at pool position 0. */
const makePad = (firstAuthorId: string, secondAuthorId?: string) => {
  const numToAttrib: Record<number, [string, string]> = {
    0: ['author', firstAuthorId],
  };
  if (secondAuthorId) {
    numToAttrib[1] = ['author', secondAuthorId];
  }
  return {pool: {numToAttrib}};
};

// ---------------------------------------------------------------------------
// Test cases
// ---------------------------------------------------------------------------

describe('/api/version-status', () => {
  // Case 1: loadState returns no `latest` → EMPTY response regardless of author/padId.
  it('case 1: returns {outdated:null, isFirstAuthor:false} when state has no latest', async () => {
    vi.mocked(stateModule.loadState).mockResolvedValue(makeState(null));

    const res = await request.get('/api/version-status').query({padId: 'testpad1'});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({outdated: null, isFirstAuthor: false});
  });

  // Case 2: current >= latest → no banner.
  it('case 2: returns {outdated:null, isFirstAuthor:false} when current >= latest', async () => {
    vi.mocked(stateModule.loadState).mockResolvedValue(makeState(SAME_OR_BEHIND));

    const res = await request.get('/api/version-status').query({padId: 'testpad2'});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({outdated: null, isFirstAuthor: false});
  });

  // Case 3: delta is patch-only → isMinorOrMoreBehind returns false → no banner.
  it('case 3: returns {outdated:null, isFirstAuthor:false} for patch-only delta', async () => {
    vi.mocked(stateModule.loadState).mockResolvedValue(makeState(PATCH_AHEAD));

    const res = await request.get('/api/version-status').query({padId: 'testpad3'});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({outdated: null, isFirstAuthor: false});
  });

  // Case 4: padId omitted → even if behind, route returns EMPTY because padId is null.
  it('case 4: returns {outdated:null, isFirstAuthor:false} when padId is omitted', async () => {
    vi.mocked(stateModule.loadState).mockResolvedValue(makeState(MINOR_AHEAD));

    const res = await request.get('/api/version-status');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({outdated: null, isFirstAuthor: false});
  });

  // Case 5: pad exists, request author is NOT pool position 0 → EMPTY.
  it('case 5: returns {outdated:null, isFirstAuthor:false} when requester is not first author', async () => {
    vi.mocked(stateModule.loadState).mockResolvedValue(makeState(MINOR_AHEAD));

    const padMap = await getPadMap();
    padMap.set('mypad5', makePad('a.alice', 'a.bob'));

    // Request is made by a.bob (position 1), not a.alice (position 0).
    sessionAuthor = 'a.bob';

    const res = await request.get('/api/version-status').query({padId: 'mypad5'});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({outdated: null, isFirstAuthor: false});

    padMap.delete('mypad5');
  });

  // Case 6: request author IS pool position 0 AND latest is minor-behind → full badge.
  it('case 6: returns {outdated:"minor", isFirstAuthor:true} when requester is first author and minor behind', async () => {
    vi.mocked(stateModule.loadState).mockResolvedValue(makeState(MINOR_AHEAD));

    const padMap = await getPadMap();
    padMap.set('mypad6', makePad('a.alice'));

    sessionAuthor = 'a.alice';

    const res = await request.get('/api/version-status').query({padId: 'mypad6'});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({outdated: 'minor', isFirstAuthor: true});

    padMap.delete('mypad6');
  });

  // Case 7: two requests to the same (padId, authorId) → loadState called exactly once (cache hit).
  it('case 7: cache hit — loadState called exactly once across two identical requests', async () => {
    vi.mocked(stateModule.loadState).mockResolvedValue(makeState(MINOR_AHEAD));

    const padMap = await getPadMap();
    padMap.set('mypad7', makePad('a.alice'));
    sessionAuthor = 'a.alice';

    await request.get('/api/version-status').query({padId: 'mypad7'});
    await request.get('/api/version-status').query({padId: 'mypad7'});

    expect(vi.mocked(stateModule.loadState)).toHaveBeenCalledTimes(1);

    padMap.delete('mypad7');
  });

  // Case 8: different (padId, authorId) pairs → cache entries are independent.
  it('case 8: cache isolation — different keys result in separate loadState calls', async () => {
    vi.mocked(stateModule.loadState).mockResolvedValue(makeState(MINOR_AHEAD));

    const padMap = await getPadMap();
    padMap.set('mypad8a', makePad('a.alice'));
    padMap.set('mypad8b', makePad('a.bob'));

    sessionAuthor = 'a.alice';
    await request.get('/api/version-status').query({padId: 'mypad8a'});

    sessionAuthor = 'a.bob';
    await request.get('/api/version-status').query({padId: 'mypad8b'});

    // Two distinct cache keys → two separate computeOutdated() calls → two loadState calls.
    expect(vi.mocked(stateModule.loadState)).toHaveBeenCalledTimes(2);

    padMap.delete('mypad8a');
    padMap.delete('mypad8b');
  });

  // Case 9: LRU eviction — cap at 2, insert 3 entries, then re-hit key 1 → 4 total loadState calls.
  it('case 9: LRU eviction causes re-computation after capacity exceeded', async () => {
    vi.mocked(stateModule.loadState).mockResolvedValue(makeState(MINOR_AHEAD));

    _setBadgeCacheCapForTests(2);

    const padMap = await getPadMap();
    padMap.set('mypad9a', makePad('a.alice'));
    padMap.set('mypad9b', makePad('a.bob'));
    padMap.set('mypad9c', makePad('a.carol'));

    // First three distinct keys: key1, key2, key3.
    // With cap=2, after inserting key3 the LRU evicts the least-recently-used
    // (key1, since key2 was accessed after key1).
    sessionAuthor = 'a.alice';
    await request.get('/api/version-status').query({padId: 'mypad9a'}); // key1, miss → call 1
    sessionAuthor = 'a.bob';
    await request.get('/api/version-status').query({padId: 'mypad9b'}); // key2, miss → call 2
    sessionAuthor = 'a.carol';
    await request.get('/api/version-status').query({padId: 'mypad9c'}); // key3, miss → call 3, evicts key1

    // Re-hit key1 → it was evicted, so another miss → call 4.
    sessionAuthor = 'a.alice';
    await request.get('/api/version-status').query({padId: 'mypad9a'}); // key1, miss → call 4

    expect(vi.mocked(stateModule.loadState)).toHaveBeenCalledTimes(4);

    padMap.delete('mypad9a');
    padMap.delete('mypad9b');
    padMap.delete('mypad9c');
  });
});
