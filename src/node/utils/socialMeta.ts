'use strict';

import type {Request} from 'express';

/**
 * Builds the Open Graph + Twitter Card <meta> tag block for the pad page,
 * timeslider and homepage. Output values are HTML-escaped — pad names are
 * user-controlled, so this is the security boundary that prevents reflected
 * XSS via crafted pad IDs.
 *
 * The description text is sourced from Etherpad's i18n catalog under the key
 * `pad.social.description`. Operators can override it per-language via the
 * standard `customLocaleStrings` mechanism in settings.json.
 */

const SOCIAL_DESCRIPTION_KEY = 'pad.social.description';

const ESCAPE_MAP: {[ch: string]: string} = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => ESCAPE_MAP[c]);

const resolveDescription = (
  locales: {[lang: string]: {[key: string]: string}} | undefined,
  renderLang: string,
): string => {
  if (!locales) return '';
  // Exact match.
  if (locales[renderLang] && locales[renderLang][SOCIAL_DESCRIPTION_KEY]) {
    return locales[renderLang][SOCIAL_DESCRIPTION_KEY];
  }
  // Primary subtag fallback (e.g. de-AT → de).
  const primary = renderLang.split('-')[0];
  if (locales[primary] && locales[primary][SOCIAL_DESCRIPTION_KEY]) {
    return locales[primary][SOCIAL_DESCRIPTION_KEY];
  }
  // English fallback.
  if (locales.en && locales.en[SOCIAL_DESCRIPTION_KEY]) {
    return locales.en[SOCIAL_DESCRIPTION_KEY];
  }
  return '';
};

const toOgLocale = (renderLang: string): string => {
  // Open Graph wants `xx_XX`. We already negotiate render language from
  // request headers; if it has a region we keep it (lowercased primary,
  // uppercased region), otherwise we just emit the primary subtag.
  const parts = renderLang.split('-');
  if (parts.length >= 2) return `${parts[0].toLowerCase()}_${parts[1].toUpperCase()}`;
  return parts[0].toLowerCase();
};

export type SocialMetaOpts = {
  url: string,
  siteName: string,
  title: string,
  description: string,
  imageUrl: string,
  imageAlt: string,
  renderLang: string,
};

export const buildSocialMetaHtml = (opts: SocialMetaOpts): string => {
  const tag = (prop: string, value: string, attr: 'property' | 'name' = 'property') =>
    `  <meta ${attr}="${prop}" content="${escapeHtml(value)}">`;

  return [
    tag('og:type', 'website'),
    tag('og:site_name', opts.siteName),
    tag('og:title', opts.title),
    tag('og:description', opts.description),
    tag('og:url', opts.url),
    tag('og:image', opts.imageUrl),
    tag('og:image:alt', opts.imageAlt),
    tag('og:locale', toOgLocale(opts.renderLang)),
    tag('twitter:card', 'summary', 'name'),
    tag('twitter:title', opts.title, 'name'),
    tag('twitter:description', opts.description, 'name'),
    tag('twitter:image', opts.imageUrl, 'name'),
    tag('twitter:image:alt', opts.imageAlt, 'name'),
  ].join('\n');
};

// Only the keys are read; values are intentionally unconstrained because the
// i18n module hands us a record whose value shape varies by language.
type AvailableLangs = {[lang: string]: unknown};

// Narrow shape of the global Settings module that this file actually touches.
// Defined locally to avoid coupling socialMeta to the full Settings surface.
type SocialMetaSettings = {
  title?: string,
  favicon?: string | null,
  publicURL?: string | null,
};

const negotiateRenderLang = (req: Request, availableLangs: AvailableLangs): string => {
  if (req && typeof req.acceptsLanguages === 'function') {
    const negotiated = req.acceptsLanguages(Object.keys(availableLangs));
    if (negotiated) return negotiated;
  }
  return 'en';
};

// Strict hostname[:port] pattern. Rejects header injection (\r\n), userinfo
// (user@host), wildcards, and any non-DNS-character garbage. Length-capped so
// a giant Host header can't blow up the response.
const HOST_RE = /^[a-z0-9]([a-z0-9.-]{0,253}[a-z0-9])?(:\d{1,5})?$/i;

const sanitizeHost = (host: string | undefined): string | null => {
  if (!host || host.length > 255) return null;
  return HOST_RE.test(host) ? host : null;
};

const sanitizePublicURL = (raw: string | null | undefined): string | null => {
  if (!raw || typeof raw !== 'string') return null;
  // Must be http(s)://host[:port], no path. Strip trailing slash if present.
  const m = raw.replace(/\/+$/, '').match(/^(https?):\/\/([^\/?#]+)$/i);
  if (!m) return null;
  return sanitizeHost(m[2]) ? `${m[1].toLowerCase()}://${m[2]}` : null;
};

// Builds an absolute URL. Prefers settings.publicURL when configured (operator-
// trusted); otherwise falls back to the request's protocol+Host with strict
// host validation so a crafted Host header can't appear in og:url / og:image.
const buildAbsoluteUrl = (
  req: Request, pathname: string, publicURL: string | null | undefined,
): string => {
  const trusted = sanitizePublicURL(publicURL);
  if (trusted) return `${trusted}${pathname}`;
  const proto = req.protocol === 'https' ? 'https' : 'http';
  const host = sanitizeHost(req.get && req.get('host')) || 'localhost';
  return `${proto}://${host}${pathname}`;
};

const resolveImageUrl = (
  req: Request, faviconSetting: string | null | undefined, publicURL: string | null | undefined,
): string => {
  if (faviconSetting && /^https?:\/\//i.test(faviconSetting)) return faviconSetting;
  return buildAbsoluteUrl(req, '/favicon.ico', publicURL);
};

export type RenderOpts = {
  req: Request,
  settings: SocialMetaSettings,
  availableLangs: AvailableLangs,
  locales: {[lang: string]: {[key: string]: string}},
  kind: 'pad' | 'timeslider' | 'home',
  padName?: string,
};

export const renderSocialMeta = (o: RenderOpts): string => {
  const renderLang = negotiateRenderLang(o.req, o.availableLangs);
  const siteName = o.settings.title || 'Etherpad';
  const description = resolveDescription(o.locales, renderLang);
  const imageUrl = resolveImageUrl(o.req, o.settings.favicon, o.settings.publicURL);
  const imageAlt = `${siteName} logo`;

  let title = siteName;
  let pathname = (o.req && o.req.originalUrl) || '/';
  if (o.padName) {
    // Express has already URL-decoded :pad route params; do not decode again.
    if (o.kind === 'pad') title = `${o.padName} | ${siteName}`;
    else if (o.kind === 'timeslider') title = `${o.padName} (history) | ${siteName}`;
  }
  const qIdx = pathname.indexOf('?');
  if (qIdx >= 0) pathname = pathname.slice(0, qIdx);

  return buildSocialMetaHtml({
    url: buildAbsoluteUrl(o.req, pathname, o.settings.publicURL),
    siteName,
    title,
    description,
    imageUrl,
    imageAlt,
    renderLang,
  });
};
