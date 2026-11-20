'use strict';

import crypto from 'node:crypto';
import type {IncomingMessage} from 'node:http';
import {sanitizeHost, sanitizePublicURL} from './sanitizeOrigin';

/**
 * Origin validation for the admin socket.io namespaces.
 *
 * Browsers attach cookies to a WebSocket handshake based on the *site*, not
 * the *origin*: a page on a sibling subdomain (other.example.com next to
 * pad.example.com) is same-site, so a SameSite=Lax session cookie is still
 * sent with its handshake. With `cookie.sameSite: "None"` any site's
 * handshake carries it. WebSockets have no CORS, so the server has to decide
 * for itself whether the page that opened the socket is Etherpad.
 *
 * None of the checks below depend on the Host header surviving a reverse
 * proxy, so a proxy that rewrites Host (and sends no X-Forwarded-Host) does
 * not break the admin UI. A handshake is decided in this order:
 *
 *   1. Origin listed in `socketIo.allowedOrigins` (or a dev origin): accept.
 *   2. `Sec-Fetch-Site` present: the browser itself compared the page's
 *      origin with the URL it opened, so the value is authoritative and
 *      proxy-independent. Accept "same-origin" and "none"; reject anything
 *      else ("same-site", "cross-site").
 *   3. Valid admin socket token in the handshake `auth` payload: accept. The
 *      admin UI fetches the token from a same-origin endpoint. That endpoint
 *      sends no CORS headers, so a page on another origin cannot read it.
 *      This covers browsers that do not send Fetch Metadata, which includes
 *      every browser talking to a plain-http (non-localhost) Etherpad.
 *   4. No Origin header: accept. Browsers always send Origin on WebSocket
 *      handshakes and on cross-origin XHR/fetch, so this is a same-origin
 *      long-polling request or a non-browser client (CLI, API tooling). A
 *      non-browser client does not hold anyone else's browser cookie.
 *   5. Origin matches the Host header, X-Forwarded-Host (only when
 *      `trustProxy` is enabled) or `publicURL`: accept. This is a fallback
 *      for clients that send neither Fetch Metadata nor a token.
 *   6. Otherwise (including the literal `null` Origin): reject.
 */

export type SocketOriginSettings = {
  trustProxy?: boolean,
  publicURL?: string | null,
  allowedOrigins?: string[] | string | null,
  // Extra origins that are always allowed (e.g. the admin Vite dev server).
  extraOrigins?: string[],
  // Whether the handshake carried a valid admin socket token.
  tokenValid?: boolean,
};

export type SocketOriginDecision = {
  allowed: boolean,
  origin: string | null,
  reason: string,
};

const firstHeader = (v: string | string[] | undefined): string | undefined => {
  if (Array.isArray(v)) v = v[0];
  if (typeof v !== 'string') return undefined;
  const first = v.split(',')[0].trim();
  return first === '' ? undefined : first;
};

/** Normalizes an origin string (scheme://host[:port]) or returns null. */
export const normalizeOrigin = (raw: unknown): string | null => {
  if (typeof raw !== 'string' || raw === '' || raw === 'null') return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  // An Origin header never carries a path, credentials, query or fragment.
  if (url.username || url.password || url.search || url.hash) return null;
  if (url.pathname !== '/' && url.pathname !== '') return null;
  return url.origin;
};

const parseAllowList = (list: SocketOriginSettings['allowedOrigins']): string[] => {
  if (list == null) return [];
  const items = Array.isArray(list) ? list : String(list).split(',');
  const out: string[] = [];
  for (const item of items) {
    const o = normalizeOrigin(typeof item === 'string' ? item.trim().replace(/\/+$/, '') : item);
    if (o != null) out.push(o);
  }
  return out;
};

/**
 * Compares the origin's host[:port] with a Host-style header value, applying
 * the origin's scheme so that default ports normalize identically
 * ("pad.example.com" == "pad.example.com:443" for an https origin).
 */
const hostMatches = (origin: URL, host: string | undefined): boolean => {
  if (!host || host.length > 255) return false;
  // Accept hostname[:port] (validated by sanitizeHost) or a bracketed IPv6
  // literal with an optional port. Anything else (userinfo, paths, CR/LF)
  // never matches.
  if (sanitizeHost(host) == null && !/^\[[0-9a-f:.]+\](:\d{1,5})?$/i.test(host)) return false;
  try {
    return new URL(`${origin.protocol}//${host}`).host === origin.host;
  } catch {
    return false;
  }
};

export const checkSocketOrigin = (
    req: Pick<IncomingMessage, 'headers'>, opts: SocketOriginSettings): SocketOriginDecision => {
  const rawOrigin = firstHeader(req.headers.origin);
  const origin = rawOrigin === undefined ? null : normalizeOrigin(rawOrigin);

  // 1. Explicit allowlist.
  if (origin != null) {
    const allowList =
        [...parseAllowList(opts.allowedOrigins), ...parseAllowList(opts.extraOrigins)];
    if (allowList.includes(origin)) {
      return {allowed: true, origin, reason: 'listed in socketIo.allowedOrigins'};
    }
  }

  // 2. Fetch Metadata, computed by the browser and untouched by proxies.
  const secFetchSite = firstHeader(req.headers['sec-fetch-site'])?.toLowerCase();
  if (secFetchSite !== undefined) {
    if (secFetchSite === 'same-origin' || secFetchSite === 'none') {
      return {allowed: true, origin: rawOrigin ?? null, reason: `Sec-Fetch-Site: ${secFetchSite}`};
    }
    return {
      allowed: false,
      origin: rawOrigin ?? null,
      reason: `Sec-Fetch-Site: ${secFetchSite.slice(0, 32)}`,
    };
  }

  // 3. Admin socket token fetched by the admin UI from a same-origin endpoint.
  if (opts.tokenValid) return {allowed: true, origin: rawOrigin ?? null, reason: 'valid token'};

  // 4. No Origin: same-origin polling or a non-browser client.
  if (rawOrigin === undefined) {
    return {allowed: true, origin: null, reason: 'no Origin header (same-origin or non-browser)'};
  }
  if (origin == null) {
    return {allowed: false, origin: rawOrigin, reason: 'malformed or null Origin'};
  }

  // 5. Fallback origin comparison for clients without Fetch Metadata or token.
  const originUrl = new URL(origin);
  if (hostMatches(originUrl, firstHeader(req.headers.host))) {
    return {allowed: true, origin, reason: 'matches Host'};
  }
  if (opts.trustProxy &&
      hostMatches(originUrl, firstHeader(req.headers['x-forwarded-host']))) {
    return {allowed: true, origin, reason: 'matches X-Forwarded-Host'};
  }
  const publicOrigin = sanitizePublicURL(opts.publicURL ?? null);
  if (publicOrigin != null && normalizeOrigin(publicOrigin) === origin) {
    return {allowed: true, origin, reason: 'matches publicURL'};
  }
  return {allowed: false, origin, reason: 'Origin does not match this server'};
};

// Per-process key for admin socket tokens. Tokens are bound to the express
// session id, so a token is only useful together with the session cookie it
// was issued for. A restart rotates the key; the admin UI fetches a fresh
// token on every (re)connect, so this is invisible to users.
const tokenKey = crypto.randomBytes(32);

/** Returns the admin socket token for an express session id. */
export const adminSocketToken = (sessionID: string): string =>
  crypto.createHmac('sha256', tokenKey).update(`admin-socket:${sessionID}`).digest('base64url');

/** Constant-time check of a client-supplied admin socket token. */
export const isValidAdminSocketToken = (sessionID: unknown, token: unknown): boolean => {
  if (typeof sessionID !== 'string' || sessionID === '' || typeof token !== 'string') return false;
  const expected = Buffer.from(adminSocketToken(sessionID));
  const actual = Buffer.from(token);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
};
