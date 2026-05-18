import settings from './Settings';

/**
 * Sanitize the URL-path prefix Etherpad is being served under.
 *
 * Headers checked in order; first non-empty (after sanitization) wins:
 *   1. `x-proxy-path` — Etherpad's own convention; always honored because
 *      the operator must explicitly configure their proxy to send it.
 *   2. `x-forwarded-prefix` — HAProxy / Traefik standard.
 *   3. `x-ingress-path` — Home Assistant supervisor ingress.
 *
 * The two standard headers (everything other than x-proxy-path) are honored
 * ONLY when `settings.trustProxy === true`, because they can otherwise be
 * forged by any internet client when Etherpad runs on a public IP.
 *
 * The header value is woven into HTML, JS, CSS and HTTP Location headers,
 * so the same value is also treated as untrusted input even when read from
 * a trusted header. Sanitization rules:
 *   - Strips every character outside `[a-zA-Z0-9\-_\/\.]`.
 *   - Collapses a leading `//+` to a single `/` so the value can never be
 *     interpreted as a protocol-relative URL.
 *   - Prepends `/` if the (non-empty) result doesn't already start with one,
 *     so callers can always concatenate the value as an absolute path prefix.
 *   - Rejects values containing `..` segments.
 *
 * The output is always either the empty string or a string that starts
 * with exactly one `/` and contains only `[A-Za-z0-9\-_./]`.
 */

const HEADER_NAMES = [
  // [headerName, requiresTrustProxy]
  ['x-proxy-path', false] as const,
  ['x-forwarded-prefix', true] as const,
  ['x-ingress-path', true] as const,
];

const cleanOne = (raw: string): string => {
  let cleaned = raw.replace(/[^a-zA-Z0-9\-_\/\.]/g, '');
  if (!cleaned) return '';
  cleaned = cleaned.replace(/^\/{2,}/, '/');
  if (cleaned[0] !== '/') cleaned = '/' + cleaned;
  if (/(?:^|\/)\.\.(?:\/|$)/.test(cleaned)) return '';
  return cleaned;
};

type ReqLike = {header: (n: string) => string|undefined};

export const sanitizeProxyPath = (
  req: ReqLike | string | undefined,
  opts: {trustProxy?: boolean} = {},
): string => {
  // String form preserves the original behaviour for callers that pre-extracted
  // the value themselves (e.g. tests). It's treated as a raw value with no
  // header-gating: the caller has already decided to use it.
  if (typeof req === 'string') return cleanOne(req);
  if (!req || typeof req.header !== 'function') return '';
  const trustProxy = opts.trustProxy ?? !!settings.trustProxy;
  for (const [name, requiresTrust] of HEADER_NAMES) {
    if (requiresTrust && !trustProxy) continue;
    const raw = req.header(name) || '';
    const cleaned = cleanOne(raw);
    if (cleaned) return cleaned;
  }
  return '';
};
