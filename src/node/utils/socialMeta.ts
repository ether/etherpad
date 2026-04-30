'use strict';

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

const negotiateRenderLang = (req: any, availableLangs: {[k: string]: any}): string => {
  if (req && typeof req.acceptsLanguages === 'function') {
    const negotiated = req.acceptsLanguages(Object.keys(availableLangs));
    if (negotiated) return negotiated;
  }
  return 'en';
};

const buildAbsoluteUrl = (req: any, pathname: string): string => {
  const proto = req.protocol || 'http';
  const host = (req.get && req.get('host')) || 'localhost';
  return `${proto}://${host}${pathname}`;
};

const resolveImageUrl = (req: any, faviconSetting: string | null | undefined): string => {
  if (faviconSetting && /^https?:\/\//i.test(faviconSetting)) return faviconSetting;
  return buildAbsoluteUrl(req, '/favicon.ico');
};

export type RenderOpts = {
  req: any,
  settings: any,
  availableLangs: {[k: string]: any},
  locales: {[lang: string]: {[key: string]: string}},
  kind: 'pad' | 'timeslider' | 'home',
  padName?: string,
};

export const renderSocialMeta = (o: RenderOpts): string => {
  const renderLang = negotiateRenderLang(o.req, o.availableLangs);
  const siteName = o.settings.title || 'Etherpad';
  const description = resolveDescription(o.locales, renderLang);
  const imageUrl = resolveImageUrl(o.req, o.settings.favicon);
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
    url: buildAbsoluteUrl(o.req, pathname),
    siteName,
    title,
    description,
    imageUrl,
    imageAlt,
    renderLang,
  });
};
