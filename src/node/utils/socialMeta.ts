'use strict';

/**
 * Builds the Open Graph + Twitter Card <meta> tag block for the pad page,
 * timeslider and homepage. Output values are HTML-escaped — pad names are
 * user-controlled, so this is the security boundary that prevents reflected
 * XSS via crafted pad IDs.
 *
 * Resolution order for the description, when `socialDescription` is an
 * object: exact `renderLang` match → primary subtag (`de-AT` → `de`) →
 * `default` key → empty string. When it is a plain string, it is used
 * verbatim regardless of `renderLang`.
 */

const ESCAPE_MAP: {[ch: string]: string} = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => ESCAPE_MAP[c]);

const resolveDescription = (
  cfg: string | {[lang: string]: string} | undefined,
  renderLang: string,
): string => {
  if (cfg == null) return '';
  if (typeof cfg === 'string') return cfg;
  if (cfg[renderLang]) return cfg[renderLang];
  const primary = renderLang.split('-')[0];
  if (cfg[primary]) return cfg[primary];
  if (cfg.default) return cfg.default;
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
  // Absolute URL of the current request (e.g. https://pad.example/p/Foo).
  url: string,
  // Site title (== settings.title).
  siteName: string,
  // Title for this page (e.g. `MyPad | Etherpad`).
  title: string,
  // Description for this page.
  description: string,
  // Absolute URL to the preview image (favicon by default).
  imageUrl: string,
  // Alt text for the preview image (a11y for chat-app screen readers).
  imageAlt: string,
  // Negotiated language (BCP-47), used for og:locale.
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
  // Honors X-Forwarded-Proto/Host when Express `trust proxy` is set, which is
  // already the case in production Etherpad deployments behind a reverse proxy.
  const proto = req.protocol || 'http';
  const host = (req.get && req.get('host')) || 'localhost';
  return `${proto}://${host}${pathname}`;
};

const resolveImageUrl = (req: any, faviconSetting: string | null | undefined): string => {
  if (faviconSetting && /^https?:\/\//i.test(faviconSetting)) return faviconSetting;
  // Etherpad serves a favicon at /favicon.ico via the favicon middleware
  // regardless of whether a custom one is configured.
  return buildAbsoluteUrl(req, '/favicon.ico');
};

export type RenderOpts = {
  req: any,
  settings: any,
  availableLangs: {[k: string]: any},
  kind: 'pad' | 'timeslider' | 'home',
  padName?: string,
};

export const renderSocialMeta = (o: RenderOpts): string => {
  const renderLang = negotiateRenderLang(o.req, o.availableLangs);
  const siteName = o.settings.title || 'Etherpad';
  const description = resolveDescription(o.settings.socialDescription, renderLang);
  const imageUrl = resolveImageUrl(o.req, o.settings.favicon);
  const imageAlt = `${siteName} logo`;

  let title = siteName;
  let pathname = (o.req && o.req.originalUrl) || '/';
  if (o.kind === 'pad' && o.padName) {
    title = `${decodeURIComponent(o.padName)} | ${siteName}`;
  } else if (o.kind === 'timeslider' && o.padName) {
    title = `${decodeURIComponent(o.padName)} (history) | ${siteName}`;
  }
  // Strip query string from canonical URL — link unfurlers should not key
  // off ephemeral params.
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
