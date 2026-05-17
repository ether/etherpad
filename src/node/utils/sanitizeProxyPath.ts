/**
 * Sanitize the `x-proxy-path` request header.
 *
 * Etherpad lets operators run behind a reverse proxy that prefixes every
 * route under a subpath (e.g. `/pad/etherpad/...`). The proxy is expected
 * to set `x-proxy-path` so that server-rendered links and redirects know
 * about the prefix. The header value is then woven into HTML, JS, CSS,
 * and HTTP Location headers — so it must be treated as untrusted input
 * even if the deployment intends to set it from a trusted proxy.
 *
 * Semantics:
 *   - Returns an empty string when the header is absent or unparseable.
 *   - Strips every character outside `[a-zA-Z0-9\-_\/\.]`.
 *   - Collapses a leading `//+` to a single `/` so the value can never
 *     be interpreted as a protocol-relative URL.
 *   - Prepends `/` if the (non-empty) result doesn't already start
 *     with one, so callers can always concatenate the value as an
 *     absolute path prefix.
 *   - Rejects values containing `..` segments.
 *
 * The output is always either the empty string or a string that starts
 * with exactly one `/` and contains only `[A-Za-z0-9\-_./]`.
 */
export const sanitizeProxyPath = (req: {header: (n: string) => string|undefined} | string | undefined): string => {
  const raw = typeof req === 'string'
      ? req
      : req && typeof req.header === 'function'
          ? (req.header('x-proxy-path') || '')
          : '';
  let cleaned = raw.replace(/[^a-zA-Z0-9\-_\/\.]/g, '');
  if (!cleaned) return '';
  // Collapse leading "//+" to a single "/" so the value can never be
  // interpreted as a protocol-relative URL when concatenated into an
  // href / Location / iframe src.
  cleaned = cleaned.replace(/^\/{2,}/, '/');
  // Ensure the value starts with exactly one "/". Several callers
  // concatenate this as a URL-path prefix (e.g. `${proxyPath}/p/...`
  // for redirects, `${proxyPath}/watch/...` for entrypoint URLs) and
  // assume the value is either empty or absolute. A header value like
  // `pad/etherpad` would otherwise become a relative redirect /
  // entrypoint and break the page.
  if (cleaned[0] !== '/') cleaned = '/' + cleaned;
  // Refuse "/.." / "../" segments — path-traversal shapes that some
  // downstream URL joiners would still honour even after the character
  // filter above.
  if (/(?:^|\/)\.\.(?:\/|$)/.test(cleaned)) return '';
  return cleaned;
};
