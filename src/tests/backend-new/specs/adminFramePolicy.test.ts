/**
 * Unit tests for the admin frame policy.
 */
import {describe, it, expect} from 'vitest';
import {
  adminFrameHeaders, isAdminPath, normalizeFrameAncestors,
} from '../../../node/utils/adminFramePolicy';

describe('isAdminPath', () => {
  it('matches the admin UI and admin-auth routes', () => {
    for (const p of ['/admin', '/admin/', '/admin/plugins', '/admin/settings',
      '/ADMIN/', '/Admin/plugins', '/admin-auth', '/admin-auth/', '/admin-auth/socket-token']) {
      expect(isAdminPath(p), p).toBe(true);
    }
  });

  it('does not match pads or other routes', () => {
    for (const p of ['/', '/p/test', '/p/admin', '/p/test/timeslider', '/p/test/export/html',
      '/static/js/pad.js', '/administrator', '/adminx/', '/api/1/createPad',
      '/pad-socket-token', '/socket.io/', '/oidc/auth', '']) {
      expect(isAdminPath(p), p).toBe(false);
    }
  });
});

describe('adminFrameHeaders', () => {
  it('defaults to same-origin only, with X-Frame-Options', () => {
    for (const v of [undefined, null, [], '', '  ']) {
      expect(adminFrameHeaders(v)).toEqual({
        'Content-Security-Policy': "frame-ancestors 'self'",
        'X-Frame-Options': 'SAMEORIGIN',
      });
    }
  });

  it('adds configured ancestors and drops X-Frame-Options', () => {
    expect(adminFrameHeaders(['https://portal.example.com', 'https://*.example.org'])).toEqual({
      'Content-Security-Policy':
          "frame-ancestors 'self' https://portal.example.com https://*.example.org",
    });
  });

  it('accepts a comma or space separated string (env substitution)', () => {
    expect(normalizeFrameAncestors('https://a.example, https://b.example  https://c.example'))
        .toEqual(['https://a.example', 'https://b.example', 'https://c.example']);
  });

  it('drops entries that could inject into the header', () => {
    expect(normalizeFrameAncestors([
      'https://ok.example',
      "https://x.example; script-src 'unsafe-inline'",
      'https://y.example\r\nSet-Cookie: a=b',
      "'none'",
      42,
    ])).toEqual(['https://ok.example']);
  });

  it('accepts the CSP source forms', () => {
    const ok = ['*', 'https:', 'https://portal.example.com', 'https://*.example.org',
      'portal.example.com', 'http://localhost:8080', 'https://example.com:*',
      'https://example.com/embed/', 'http://127.0.0.1:9001'];
    expect(normalizeFrameAncestors(ok)).toEqual(ok);
  });

  it('drops malformed sources and keeps X-Frame-Options when none are left', () => {
    const bad = ['https://', 'https://:443', '://example.com', 'https://exa mple.com',
      'https://example..com', 'https://-example.com', 'https://example.com:99999x',
      "'self'", '**.example.com'];
    expect(normalizeFrameAncestors(bad)).toEqual([]);
    expect(adminFrameHeaders(bad)).toEqual({
      'Content-Security-Policy': "frame-ancestors 'self'",
      'X-Frame-Options': 'SAMEORIGIN',
    });
  });
});
