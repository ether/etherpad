import {describe, it, expect} from 'vitest';
import {checkLatestRelease, FetchResult} from '../../../../node/updater/VersionChecker';
import {ReleaseInfo} from '../../../../node/updater/types';

const ghBody = (overrides: Partial<{tag_name: string; body: string; prerelease: boolean; html_url: string; published_at: string}> = {}) => ({
  tag_name: 'v2.7.2',
  body: 'Some changes.\n<!-- updater: vulnerable-below 2.6.4 -->',
  prerelease: false,
  html_url: 'https://github.com/ether/etherpad/releases/tag/v2.7.2',
  published_at: '2026-04-25T00:00:00Z',
  ...overrides,
});

describe('checkLatestRelease', () => {
  it('returns parsed release on 200', async () => {
    const fetcher = async () => ({
      status: 200,
      etag: 'abc',
      json: ghBody(),
    } as FetchResult);
    const r = await checkLatestRelease({fetcher, prevEtag: null, repo: 'ether/etherpad'});
    expect(r.kind).toBe('updated');
    if (r.kind !== 'updated') return;
    const expected: ReleaseInfo = {
      version: '2.7.2',
      tag: 'v2.7.2',
      body: 'Some changes.\n<!-- updater: vulnerable-below 2.6.4 -->',
      publishedAt: '2026-04-25T00:00:00Z',
      prerelease: false,
      htmlUrl: 'https://github.com/ether/etherpad/releases/tag/v2.7.2',
    };
    expect(r.release).toEqual(expected);
    expect(r.etag).toBe('abc');
    expect(r.vulnerableBelow).toEqual([{announcedBy: 'v2.7.2', threshold: '2.6.4'}]);
  });

  it('returns notmodified on 304', async () => {
    const fetcher = async () => ({status: 304, etag: 'abc', json: null} as FetchResult);
    const r = await checkLatestRelease({fetcher, prevEtag: 'abc', repo: 'ether/etherpad'});
    expect(r.kind).toBe('notmodified');
  });

  it('returns ratelimited on 403', async () => {
    const fetcher = async () => ({status: 403, etag: null, json: null} as FetchResult);
    const r = await checkLatestRelease({fetcher, prevEtag: null, repo: 'ether/etherpad'});
    expect(r.kind).toBe('ratelimited');
  });

  it('skips prereleases', async () => {
    const fetcher = async () => ({
      status: 200, etag: null, json: ghBody({prerelease: true}),
    } as FetchResult);
    const r = await checkLatestRelease({fetcher, prevEtag: null, repo: 'ether/etherpad'});
    expect(r.kind).toBe('skipped-prerelease');
  });

  it('returns error on unexpected status', async () => {
    const fetcher = async () => ({status: 500, etag: null, json: null} as FetchResult);
    const r = await checkLatestRelease({fetcher, prevEtag: null, repo: 'ether/etherpad'});
    expect(r.kind).toBe('error');
  });

  it('passes prevEtag to fetcher', async () => {
    let observed: string | null = '';
    const fetcher = async (_url: string, etag: string | null) => {
      observed = etag;
      return {status: 304, etag: 'abc', json: null} as FetchResult;
    };
    await checkLatestRelease({fetcher, prevEtag: 'old', repo: 'ether/etherpad'});
    expect(observed).toBe('old');
  });
});
