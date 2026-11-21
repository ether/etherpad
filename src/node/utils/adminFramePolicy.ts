'use strict';

/**
 * Frame policy for the admin UI.
 *
 * The admin UI only allows Etherpad's own origin (plus any origins listed in
 * the adminFrameAncestors setting) to show it in a frame.
 *
 * Only /admin and /admin-auth get these headers. Pads, the timeslider and
 * every other route stay frameable, because embedding pads is a supported
 * use case.
 */

import log4js from 'log4js';

const logger = log4js.getLogger('adminFramePolicy');

/**
 * True for /admin, /admin/..., /admin-auth and /admin-auth/... Express routes
 * case-insensitively, so /ADMIN/ serves the admin UI too and must match.
 */
export const isAdminPath = (pathname: string): boolean => {
  const p = String(pathname || '').toLowerCase();
  return p === '/admin' || p.startsWith('/admin/') ||
      p === '/admin-auth' || p.startsWith('/admin-auth/');
};

// CSP frame-ancestors source forms accepted here (case-insensitive):
//   *                                      any origin
//   https:                                 scheme-source
//   [scheme://]host[:port][/path]          host-source; host may be "*" or
//                                          start with "*." and port may be "*"
// Anything else (keywords such as 'self', a bare "https://", stray
// delimiters, whitespace) is rejected so a typo cannot weaken the header.
const SCHEME_SOURCE = /^[a-z][a-z0-9+.-]*:$/i;
const HOST_SOURCE = new RegExp(
    '^(?:[a-z][a-z0-9+.-]*://)?' + // optional scheme
    '(?:\\*|(?:\\*\\.)?[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*)' + // host
    '(?::(?:[0-9]{1,5}|\\*))?' + // optional port
    '(?:/[A-Za-z0-9._~!$&()*+=:@%/-]*)?$', 'i'); // optional path, no ; , ' " or spaces
const validSource = (s: string) => s === '*' || SCHEME_SOURCE.test(s) || HOST_SOURCE.test(s);

let lastWarned = '';

/**
 * Turns the `adminFrameAncestors` setting (an array, or a comma/space
 * separated string as the Docker env substitution produces) into a list of
 * CSP sources. Invalid entries are dropped with a warning.
 */
export const normalizeFrameAncestors = (value: unknown): string[] => {
  let list: unknown[];
  if (Array.isArray(value)) list = value;
  else if (typeof value === 'string') list = value.split(/[\s,]+/);
  else list = [];
  const out: string[] = [];
  const bad: string[] = [];
  for (const entry of list) {
    if (typeof entry !== 'string') { bad.push(String(entry)); continue; }
    const s = entry.trim();
    if (s === '') continue;
    if (validSource(s)) out.push(s);
    else bad.push(s);
  }
  if (bad.length > 0) {
    const msg = `Ignoring invalid adminFrameAncestors entries: ${JSON.stringify(bad).slice(0, 255)}`;
    if (msg !== lastWarned) {
      lastWarned = msg;
      logger.warn(msg);
    }
  }
  return out;
};

/**
 * Headers for an admin response. With no extra ancestors the admin UI can only
 * be framed by Etherpad's own origin. When the operator lists extra ancestors,
 * X-Frame-Options is left out because it cannot express a list, and browsers
 * that support CSP ignore it anyway when frame-ancestors is present.
 */
export const adminFrameHeaders = (ancestorsSetting: unknown): Record<string, string> => {
  const extra = normalizeFrameAncestors(ancestorsSetting);
  if (extra.length === 0) {
    return {
      'Content-Security-Policy': "frame-ancestors 'self'",
      'X-Frame-Options': 'SAMEORIGIN',
    };
  }
  return {'Content-Security-Policy': `frame-ancestors 'self' ${extra.join(' ')}`};
};
