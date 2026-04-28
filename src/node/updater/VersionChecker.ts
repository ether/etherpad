import {ReleaseInfo, VulnerableBelowDirective} from './types';
import {parseVulnerableBelow} from './versionCompare';

export interface FetchResult {
  status: number;
  etag: string | null;
  /** Parsed JSON body on 200, otherwise null. */
  json: any;
}

/** Adapter so tests can stub the network. Maps URL+ETag to a FetchResult. */
export type Fetcher = (url: string, etag: string | null) => Promise<FetchResult>;

/** Discriminated union of every outcome the checker can return. */
export type CheckResult =
  | {kind: 'updated'; release: ReleaseInfo; etag: string | null; vulnerableBelow: VulnerableBelowDirective[]}
  | {kind: 'notmodified'}
  | {kind: 'ratelimited'}
  | {kind: 'skipped-prerelease'; etag: string | null}
  | {kind: 'error'; status: number};

export interface CheckOptions {
  fetcher: Fetcher;
  prevEtag: string | null;
  /** GitHub repo as `owner/name`, e.g. `ether/etherpad`. */
  repo: string;
}

/**
 * Hit `/repos/{repo}/releases/latest` on GitHub. Pass the previous ETag for `If-None-Match`.
 * Returns one of: 'updated' | 'notmodified' | 'ratelimited' | 'skipped-prerelease' | 'error'.
 */
export const checkLatestRelease = async (
  {fetcher, prevEtag, repo}: CheckOptions,
): Promise<CheckResult> => {
  const url = `https://api.github.com/repos/${repo}/releases/latest`;
  const res = await fetcher(url, prevEtag);

  if (res.status === 304) return {kind: 'notmodified'};
  if (res.status === 403 || res.status === 429) return {kind: 'ratelimited'};
  if (res.status !== 200 || !res.json) return {kind: 'error', status: res.status};

  const j = res.json;
  if (j.prerelease) return {kind: 'skipped-prerelease', etag: res.etag};

  if (typeof j.tag_name !== 'string' ||
      typeof j.html_url !== 'string' ||
      typeof j.published_at !== 'string') {
    return {kind: 'error', status: 200};
  }

  const tag = j.tag_name;
  const version = tag.replace(/^v/, '');
  const body: string = typeof j.body === 'string' ? j.body : '';

  const release: ReleaseInfo = {
    version,
    tag,
    body,
    publishedAt: j.published_at,
    prerelease: false,
    htmlUrl: j.html_url,
  };

  const directiveThreshold = parseVulnerableBelow(body);
  const vulnerableBelow: VulnerableBelowDirective[] = directiveThreshold
    ? [{announcedBy: tag, threshold: directiveThreshold}]
    : [];

  return {kind: 'updated', release, etag: res.etag, vulnerableBelow};
};

/** Production fetcher built on Node 18+ native fetch. Honors If-None-Match for cheap polling. */
export const realFetcher: Fetcher = async (url, etag) => {
  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'etherpad-self-update',
  };
  if (etag) headers['If-None-Match'] = etag;
  const r = await fetch(url, {headers});
  const newEtag = r.headers.get('etag');
  let json: any = null;
  if (r.status === 200) {
    try { json = await r.json(); } catch { json = null; }
  }
  return {status: r.status, etag: newEtag, json};
};
