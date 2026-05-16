'use strict';

import padutils from '../../static/js/pad_utils';

const isCrossSiteEmbed = (req: any): boolean => {
  const fetchSite = req.headers?.['sec-fetch-site'];
  return fetchSite === 'cross-site';
};

/**
 * Idempotent: if the request already carries a valid author-token cookie,
 * returns its value and does not touch the response. Otherwise mints a fresh
 * `t.<randomString>` token, writes it to the response as an HttpOnly cookie,
 * and returns it. Callers pass the settings object rather than importing it
 * here so the helper stays pure and easy to unit test.
 */
export const ensureAuthorTokenCookie = (
  req: any, res: any, settings: {cookie: {prefix?: string}},
): string => {
  const prefix = settings.cookie?.prefix || '';
  const cookieName = `${prefix}token`;
  const existing = req.cookies?.[cookieName];
  if (typeof existing === 'string' && padutils.isValidAuthorToken(existing)) {
    return existing;
  }
  const token = padutils.generateAuthorToken();
  res.cookie(cookieName, token, {
    httpOnly: true,
    secure: Boolean(req.secure),
    sameSite: isCrossSiteEmbed(req) ? 'none' : 'lax',
    maxAge: 60 * 24 * 60 * 60 * 1000, // 60 days — matches the pre-PR3 client default
    path: '/',
  });
  return token;
};
