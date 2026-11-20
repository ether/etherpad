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

// Admin socket tokens are an HMAC of the express session id, keyed with the
// session cookie signing secret(s). With key rotation enabled those come from
// SecretRotator, which shares them through the database, so every Etherpad
// instance on the same database issues and accepts the same tokens. The
// random key is only used until express has set the secrets (e.g. in unit
// tests). The admin UI fetches a fresh token on every (re)connect, so rotation
// is invisible to users.
const fallbackKey = crypto.randomBytes(32).toString('hex');
let getSecrets: () => readonly string[] = () => [fallbackKey];

/**
 * Called by the express hook once the session signing secrets are known.
 * Returns the previous getter so tests can restore it.
 */
export const setAdminSocketTokenSecrets =
    (fn: () => readonly string[]): (() => readonly string[]) => {
      const prev = getSecrets;
      getSecrets = fn;
      return prev;
    };

const currentSecrets = (): string[] => {
  const secrets = (getSecrets() || []).filter((s) => typeof s === 'string' && s !== '');
  return secrets.length > 0 ? secrets : [fallbackKey];
};

const mac = (secret: string, sessionID: string): string =>
  crypto.createHmac('sha256', secret)
      .update(`etherpad admin socket token\0${sessionID}`)
      .digest('base64url');

/** Returns the admin socket token for an express session id. */
export const adminSocketToken = (sessionID: string): string =>
  mac(currentSecrets()[0], sessionID);

/** Constant-time check of a client-supplied admin socket token. */
export const isValidAdminSocketToken = (sessionID: unknown, token: unknown): boolean => {
  if (typeof sessionID !== 'string' || sessionID === '' || typeof token !== 'string') return false;
  const actual = Buffer.from(token);
  let ok = false;
  for (const secret of currentSecrets()) {
    const expected = Buffer.from(mac(secret, sessionID));
    if (actual.length === expected.length && crypto.timingSafeEqual(actual, expected)) ok = true;
  }
  return ok;
};

// ---------------------------------------------------------------------------
// Pad socket token (default socket.io namespace).
//
// The pad socket identifies the visitor from cookies the browser attaches to
// the handshake: the HttpOnly author `token` cookie, the integrator's group
// `sessionID` cookie and the express session (when it holds a logged-in
// user). Pads have no login in the default config, so the token is bound to
// exactly those values. A page on another origin can fetch a token for its
// own cookies, but the handshake it opens carries the visitor's cookies, so
// the token does not match. Binding every credential the pad handler reads
// also defeats cookie tossing from a sibling subdomain: whatever credentials
// the server ends up using are the ones the token was issued for.
// ---------------------------------------------------------------------------

/**
 * Reads one cookie from a raw Cookie header. Same rules as the pad handler
 * uses when it resolves the author token: first match wins, undecodable
 * values count as absent.
 */
export const readCookieFromHeader = (cookieHeader: unknown, name: string): string | null => {
  if (typeof cookieHeader !== 'string' || cookieHeader === '') return null;
  const match = cookieHeader.split(/;\s*/).find((c) => c.split('=')[0] === name);
  if (!match) return null;
  const raw = match.split('=').slice(1).join('=');
  try {
    return decodeURIComponent(raw);
  } catch (err) {
    if (err instanceof URIError) return null;
    throw err;
  }
};

export type PadCredentialRequest = {
  headers?: {cookie?: string | string[]},
  session?: {user?: unknown} | null,
  sessionID?: unknown,
};

/** The credentials of a request that the pad handler would act on. */
export const padCredentialBinding = (req: PadCredentialRequest, cookiePrefix: string): string => {
  const cookieHeader = Array.isArray(req.headers?.cookie) ?
    req.headers!.cookie.join('; ') : req.headers?.cookie;
  const authorToken = readCookieFromHeader(cookieHeader, `${cookiePrefix}token`) || '';
  const groupSession = readCookieFromHeader(cookieHeader, `${cookiePrefix}sessionID`) ||
      readCookieFromHeader(cookieHeader, 'sessionID') || '';
  // The express session only grants anything once it holds a user. Anonymous
  // sessions are not saved (saveUninitialized: false), so their id changes on
  // every request and must not be part of the binding.
  const loginSession = req.session?.user != null && typeof req.sessionID === 'string' ?
    req.sessionID : '';
  return JSON.stringify([authorToken, groupSession, loginSession]);
};

const padMac = (secret: string, binding: string): string =>
  crypto.createHmac('sha256', secret)
      .update(`etherpad pad socket token\0${binding}`)
      .digest('base64url');

/** Returns the pad socket token for the credentials a request carries. */
export const padSocketToken = (binding: string): string => padMac(currentSecrets()[0], binding);

/** Constant-time check of a client-supplied pad socket token. */
export const isValidPadSocketToken = (binding: string, token: unknown): boolean => {
  if (typeof token !== 'string' || token === '' || token.length > 128) return false;
  const actual = Buffer.from(token);
  let ok = false;
  for (const secret of currentSecrets()) {
    const expected = Buffer.from(padMac(secret, binding));
    if (actual.length === expected.length && crypto.timingSafeEqual(actual, expected)) ok = true;
  }
  return ok;
};
