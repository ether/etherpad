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

// A CSP source expression must not carry characters that end the directive
// (";"), start another policy (","), separate sources (whitespace) or quote a
// keyword. Anything else is passed through for the browser to interpret.
const validSource = (s: string) => s.length > 0 && !/[\s;,'"\u0000-\u001f\u007f]/.test(s);

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
