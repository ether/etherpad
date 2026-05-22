/**
 * Unit tests for the shared sanitizeProxyPath helper.
 *
 * The helper:
 *   - returns "" when the header is absent;
 *   - drops every character outside [A-Za-z0-9_./-];
 *   - collapses a leading `//+` to a single `/` (so the value can never
 *     be interpreted as a protocol-relative URL);
 *   - rejects path-traversal segments.
 */
import {describe, it, expect} from 'vitest';
import {sanitizeProxyPath} from '../../../node/utils/sanitizeProxyPath';

const mockReq = (val: string|undefined) => ({
  header: (name: string) => name.toLowerCase() === 'x-proxy-path' ? val : undefined,
});

describe('sanitizeProxyPath', () => {
  describe('absent / empty', () => {
    it('returns "" when the header is missing', () => {
      expect(sanitizeProxyPath(mockReq(undefined))).toBe('');
    });

    it('returns "" when the header is empty', () => {
      expect(sanitizeProxyPath(mockReq(''))).toBe('');
    });

    it('returns "" when the req object has no header()', () => {
      expect(sanitizeProxyPath(undefined)).toBe('');
      // @ts-expect-error — exercising the defensive branch
      expect(sanitizeProxyPath({})).toBe('');
    });
  });

  describe('character class', () => {
    it('preserves slashes, dots, hyphens, underscores, alphanumerics', () => {
      expect(sanitizeProxyPath(mockReq('/pad/etherpad'))).toBe('/pad/etherpad');
      expect(sanitizeProxyPath(mockReq('/a-b_c.d/0-9'))).toBe('/a-b_c.d/0-9');
    });

    it('strips angle brackets, quotes, scripts, and whitespace', () => {
      // The exact survivor string depends on which characters are in
      // the allow-list; what matters here is that none of the
      // HTML-breaking characters survive (no `<`, `>`, quote, paren,
      // equals, etc).
      const cleaned = sanitizeProxyPath(mockReq(
          '"><script>alert(1)</script><i a="'));
      expect(cleaned).not.toMatch(/[<>"'()=&]/);
      // Newlines, tabs, control chars — none of these belong in a URL path.
      expect(sanitizeProxyPath(mockReq('/a\n/b'))).toBe('/a/b');
    });

    it('strips colons and backslashes (no scheme can survive)', () => {
      // A full URL gets stripped to its path-like residue. Specifically the
      // leading scheme + `://` collapses such that no `:` survives — so the
      // result can never be parsed by a browser as an absolute URL.
      const cleaned = sanitizeProxyPath(mockReq('http://evil.example'));
      expect(cleaned).not.toMatch(/[:\\]/);
      expect(sanitizeProxyPath(mockReq('http:\\\\evil.example')))
          .toBe('/httpevil.example');
    });
  });

  describe('protocol-relative URL rejection', () => {
    it('collapses a leading // to a single /', () => {
      expect(sanitizeProxyPath(mockReq('//evil.example/pwn'))).toBe('/evil.example/pwn');
    });

    it('collapses a leading /// or ///// to a single /', () => {
      expect(sanitizeProxyPath(mockReq('///x'))).toBe('/x');
      expect(sanitizeProxyPath(mockReq('/////x'))).toBe('/x');
    });

    it('does NOT collapse mid-path double-slashes (they are harmless prefixes)', () => {
      // A double slash inside the path stays — only the leading run is
      // dangerous (it changes the URL authority).
      expect(sanitizeProxyPath(mockReq('/a//b'))).toBe('/a//b');
    });
  });

  describe('path traversal rejection', () => {
    it('rejects values containing /../', () => {
      expect(sanitizeProxyPath(mockReq('/a/../b'))).toBe('');
    });

    it('rejects values starting with ../', () => {
      expect(sanitizeProxyPath(mockReq('../b'))).toBe('');
    });

    it('rejects values ending with /..', () => {
      expect(sanitizeProxyPath(mockReq('/a/..'))).toBe('');
    });

    it('allows literal "..something" segments (only bare ".." traversal is blocked)', () => {
      expect(sanitizeProxyPath(mockReq('/a/..b/c'))).toBe('/a/..b/c');
    });
  });

  describe('string input form', () => {
    it('also accepts a string directly (not just a req object)', () => {
      expect(sanitizeProxyPath('//x')).toBe('/x');
      expect(sanitizeProxyPath('/pad')).toBe('/pad');
    });
  });

  describe('absolute-prefix guarantee', () => {
    it('prepends "/" when the input lacks a leading slash', () => {
      expect(sanitizeProxyPath(mockReq('pad/etherpad'))).toBe('/pad/etherpad');
      expect(sanitizeProxyPath('pad')).toBe('/pad');
      // Single alphanumeric stays a path, not a host.
      expect(sanitizeProxyPath('x')).toBe('/x');
    });

    it('does not double-prefix a value that already starts with /', () => {
      expect(sanitizeProxyPath('/pad/etherpad')).toBe('/pad/etherpad');
    });

    it('the // collapse runs before the prepend, so /// still becomes /', () => {
      // After the strip + the //+ collapse the prepend is a no-op for
      // values that already had a leading slash.
      expect(sanitizeProxyPath('//pad')).toBe('/pad');
    });
  });

  describe('X-Forwarded-Prefix and X-Ingress-Path', () => {
    const mockReqMulti = (headers: Record<string, string|undefined>) => ({
      header: (name: string) => headers[name.toLowerCase()],
    });

    it('reads X-Forwarded-Prefix when trustProxy is true', () => {
      expect(sanitizeProxyPath(
          mockReqMulti({'x-forwarded-prefix': '/foo'}),
          {trustProxy: true})).toBe('/foo');
    });

    it('reads X-Ingress-Path when trustProxy is true', () => {
      expect(sanitizeProxyPath(
          mockReqMulti({'x-ingress-path': '/api/hassio_ingress/abc'}),
          {trustProxy: true})).toBe('/api/hassio_ingress/abc');
    });

    it('ignores X-Forwarded-Prefix when trustProxy is false', () => {
      expect(sanitizeProxyPath(
          mockReqMulti({'x-forwarded-prefix': '/foo'}),
          {trustProxy: false})).toBe('');
    });

    it('ignores X-Ingress-Path when trustProxy is false', () => {
      expect(sanitizeProxyPath(
          mockReqMulti({'x-ingress-path': '/foo'}),
          {trustProxy: false})).toBe('');
    });

    it('x-proxy-path still works without trustProxy (legacy Etherpad convention)', () => {
      expect(sanitizeProxyPath(
          mockReqMulti({'x-proxy-path': '/legacy'}),
          {trustProxy: false})).toBe('/legacy');
    });

    it('x-proxy-path wins over standard headers when all are present', () => {
      expect(sanitizeProxyPath(
          mockReqMulti({
            'x-proxy-path': '/legacy',
            'x-forwarded-prefix': '/forwarded',
            'x-ingress-path': '/ingress',
          }),
          {trustProxy: true})).toBe('/legacy');
    });

    it('x-forwarded-prefix beats x-ingress-path when both are present', () => {
      expect(sanitizeProxyPath(
          mockReqMulti({
            'x-forwarded-prefix': '/forwarded',
            'x-ingress-path': '/ingress',
          }),
          {trustProxy: true})).toBe('/forwarded');
    });

    it('sanitises standard headers the same as x-proxy-path', () => {
      expect(sanitizeProxyPath(
          mockReqMulti({'x-forwarded-prefix': '//evil.example/pwn'}),
          {trustProxy: true})).toBe('/evil.example/pwn');
      expect(sanitizeProxyPath(
          mockReqMulti({'x-ingress-path': '/a/../b'}),
          {trustProxy: true})).toBe('');
      expect(sanitizeProxyPath(
          mockReqMulti({'x-forwarded-prefix': 'pad'}),
          {trustProxy: true})).toBe('/pad');
    });

    it('defaults trustProxy from settings when opts not provided', async () => {
      const settings = (await import('../../../node/utils/Settings')).default;
      const original = settings.trustProxy;
      try {
        settings.trustProxy = true;
        expect(sanitizeProxyPath(
            mockReqMulti({'x-forwarded-prefix': '/x'})))
            .toBe('/x');
        settings.trustProxy = false;
        expect(sanitizeProxyPath(
            mockReqMulti({'x-forwarded-prefix': '/x'})))
            .toBe('');
      } finally {
        settings.trustProxy = original;
      }
    });
  });
});
