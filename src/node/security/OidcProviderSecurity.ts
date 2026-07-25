import crypto from 'node:crypto';

/**
 * Security helpers for the embedded OIDC provider (`OAuth2Provider.ts`).
 *
 * Kept in a dependency-light module (only `node:crypto`) so the pure decisions
 * can be unit-tested without constructing an `oidc-provider` instance.
 */

// Domain-separation label so the derived cookie key is cryptographically
// unrelated to any other use of the session secret. The trailing NUL keeps the
// label from ambiguously running into the appended secret.
export const COOKIE_KEY_DERIVATION_LABEL = 'etherpad-oidc-provider-cookie-signing-key\0';

/**
 * Resolve the cookie-signing keys for the embedded OIDC provider.
 *
 * oidc-provider signs its short-lived interaction/session/grant cookies
 * (`_interaction`, `_interaction_resume`, `_grant`, `_session`) with an HMAC
 * keyed by these values. Shipping a hardcoded key (historically `['oidc']`) let
 * anyone with the public source forge valid `.sig` cookies, defeating the
 * provider's cookie-integrity guarantee. Reported by `meifukun`.
 *
 * Resolution order:
 *   1. An explicit operator-supplied `settings.sso.cookieKeys` array — use this
 *      for controlled rotation: `[newKey, ...oldKeys]`.
 *   2. The live secrets array of a DB-backed `SecretRotator` (the same mechanism
 *      the Express session-cookie stack uses). This is the default path: it is
 *      stable across restarts, shared across horizontally-scaled pods via the
 *      database, and rotates automatically. The array is returned BY REFERENCE
 *      so a later in-place rotation propagates to oidc-provider/keygrip without
 *      reconstructing the provider.
 *   3. A value derived from the persisted Etherpad session secret
 *      (`SESSIONKEY.txt`) via a domain-separated SHA-256 — used when rotation is
 *      disabled but a static session key exists. Stable across restarts/pods,
 *      never committed to source.
 *   4. As a last resort (no key material at all), an ephemeral per-process
 *      random key. The integrity boundary holds, but interactions won't survive
 *      a restart or span multiple pods.
 */
export const resolveOidcCookieKeys = (
  opts: {cookieKeys?: unknown, rotatedSecrets?: string[] | null, sessionKey?: string | null},
): string[] => {
  const {cookieKeys, rotatedSecrets, sessionKey} = opts;

  if (Array.isArray(cookieKeys)) {
    const usable = cookieKeys.filter((k): k is string => typeof k === 'string' && k.length > 0);
    if (usable.length > 0) return usable;
  }

  // Return the rotator's array by reference (do not copy/filter) so in-place
  // rotation is observed live by keygrip.
  if (Array.isArray(rotatedSecrets) &&
      rotatedSecrets.some((k) => typeof k === 'string' && k.length > 0)) {
    return rotatedSecrets;
  }

  if (typeof sessionKey === 'string' && sessionKey.length > 0) {
    const derived = crypto.createHash('sha256')
        .update(COOKIE_KEY_DERIVATION_LABEL)
        .update(sessionKey)
        .digest('hex');
    return [derived];
  }

  return [crypto.randomBytes(32).toString('hex')];
};

/**
 * Origin allow-list decision for the embedded OIDC provider's CORS-enabled
 * endpoints (`/oidc/token`, `/oidc/me`, ...). oidc-provider invokes
 * `clientBasedCORS(ctx, origin, client)` for every cross-origin request;
 * returning `true` unconditionally (the historical behavior) reflected ANY
 * `Origin` into `Access-Control-Allow-Origin`, letting unregistered origins read
 * token/userinfo responses that use non-cookie credentials (Authorization
 * headers, POST-body client credentials). Reported by `meifukun`.
 *
 * An origin is allowed only when it exactly matches the origin (scheme + host +
 * port) of one of the client's registered redirect URIs.
 */
export const isOriginAllowedForOidcClient = (
  origin: string | undefined | null,
  client: {redirectUris?: unknown} | undefined | null,
): boolean => {
  if (!origin || !client) return false;
  const uris = (client as {redirectUris?: unknown}).redirectUris;
  if (!Array.isArray(uris)) return false;
  return uris.some((uri: unknown) => {
    if (typeof uri !== 'string') return false;
    try {
      return new URL(uri).origin === origin;
    } catch {
      return false;
    }
  });
};
