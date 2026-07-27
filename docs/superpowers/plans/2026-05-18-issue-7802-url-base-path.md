# URL base-path support (issue #7802) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Etherpad emit prefix-correct asset URLs, manifest URLs, social-meta URLs, and admin links when served behind a reverse proxy that sets `X-Forwarded-Prefix` or `X-Ingress-Path` (in addition to the already-supported `x-proxy-path`).

**Architecture:** Extend the existing `sanitizeProxyPath` helper to accept the two standard headers (gated on `settings.trustProxy === true`). Then thread the resulting `proxyPath` into the three remaining spots that don't already use it: the `/manifest.json` handler, `socialMeta.buildAbsoluteUrl`, and the leading-slash URLs in `index.html`/`pad.html`/`timeslider.html`/`export_html.html`. Fix the pre-existing `..`-count bug on `<link rel="manifest">` in pad.html and timeslider.html.

**Tech Stack:** TypeScript, Express, EJS templates, vitest + mocha.

**Spec:** `docs/superpowers/specs/2026-05-18-issue-7802-url-base-path-support-design.md`

---

## File Structure

Files created or modified by this plan. Each file has one focused responsibility:

| File | Responsibility |
|---|---|
| `src/node/utils/sanitizeProxyPath.ts` | Single source of truth for "the URL prefix this request is being served under". Returns `''` or `/...`. Pure function. |
| `src/tests/backend-new/specs/sanitizeProxyPath.test.ts` | Truth table for `sanitizeProxyPath` — extended with X-Forwarded-Prefix, X-Ingress-Path, and trustProxy gating. |
| `src/node/hooks/express/pwa.ts` | `/manifest.json` route — now emits prefix-aware icon `src`, `start_url`. |
| `src/tests/backend/specs/pwaManifest.ts` *(new)* | Supertest coverage for `/manifest.json` under proxy headers. |
| `src/node/utils/socialMeta.ts` | `buildAbsoluteUrl` accepts an explicit `proxyPath`. |
| `src/tests/backend/specs/socialMeta-unit.ts` | Extended with proxyPath cases. |
| `src/node/hooks/express/specialpages.ts` | `proxyPath` already computed for pad/timeslider routes — passed into the EJS context and to `renderSocialMeta`. Also wired into the index route, where it's currently only used for the `entrypoint`. |
| `src/templates/index.html` | Manifest link + jslicense link use `proxyPath`. |
| `src/templates/pad.html` | Reconnect form action + jslicense link use `proxyPath`. Pre-existing `../../manifest.json` (one `..` too many) reduced to `../manifest.json` — strict improvement; same value at root mount, correct value under prefix. |
| `src/templates/timeslider.html` | Reconnect form action + jslicense link use `proxyPath`. Pre-existing `../../../manifest.json` reduced to `../../manifest.json` — same rationale. |
| `src/templates/export_html.html` + the export-HTML route handler | Manifest link uses `proxyPath`. |
| `src/tests/backend/specs/urlBasePath.ts` *(new)* | End-to-end backend integration test — assert prefix appears everywhere after one supertest GET with `X-Ingress-Path`. |
| `src/node/utils/Settings.ts` (doc comment only) | Document the three honored header names against `trustProxy`. |
| `settings.json.template` (doc comment only) | Same. |

---

## Task 1: Extend sanitizeProxyPath to support standard headers under trustProxy

**Files:**
- Modify: `src/node/utils/sanitizeProxyPath.ts`
- Modify: `src/tests/backend-new/specs/sanitizeProxyPath.test.ts`

### Background

Today: only `x-proxy-path` is read. HA ingress sends `X-Ingress-Path`; nginx subpath setups conventionally send `X-Forwarded-Prefix`. We add both. The custom `x-proxy-path` stays un-gated (it's an Etherpad convention an operator opted into). The two standard headers must be gated on `settings.trustProxy === true` because they can otherwise be set by any internet client when Etherpad runs on a public IP.

Precedence (first non-empty wins): `x-proxy-path` → `x-forwarded-prefix` → `x-ingress-path`.

### Steps

- [ ] **Step 1: Write failing tests for the new behaviour**

Append to `src/tests/backend-new/specs/sanitizeProxyPath.test.ts` (inside the top-level `describe('sanitizeProxyPath', ...)` block, after the existing `describe`s but before the closing brace):

```typescript
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
      // Verifies the default-path reads from settings — when opts omitted,
      // the helper falls back to settings.trustProxy at call time.
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter ./src test:vitest -- src/tests/backend-new/specs/sanitizeProxyPath.test.ts
```

Expected: 9 failing tests (all the new ones), all 13 existing tests still pass.

- [ ] **Step 3: Update `sanitizeProxyPath.ts` to support the new headers and the trustProxy gate**

Replace the entire body of `src/node/utils/sanitizeProxyPath.ts` with:

```typescript
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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter ./src test:vitest -- src/tests/backend-new/specs/sanitizeProxyPath.test.ts
```

Expected: all 22 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/node/utils/sanitizeProxyPath.ts \
        src/tests/backend-new/specs/sanitizeProxyPath.test.ts
git commit -m "feat(proxy): accept X-Forwarded-Prefix and X-Ingress-Path under trustProxy (#7802)"
```

---

## Task 2: Make `/manifest.json` prefix-aware

**Files:**
- Modify: `src/node/hooks/express/pwa.ts`
- Test: `src/tests/backend/specs/pwaManifest.ts` *(new)*

### Steps

- [ ] **Step 1: Write the failing test**

Create `src/tests/backend/specs/pwaManifest.ts`:

```typescript
'use strict';

/**
 * Coverage for /manifest.json prefix-awareness.
 *
 * Without a proxy header the manifest should emit today's values
 * (leading-slash absolute paths). With a sanitised `x-proxy-path`,
 * `x-forwarded-prefix` (requires trustProxy) or `x-ingress-path`
 * (requires trustProxy), the manifest should emit prefixed paths so
 * the PWA renders icons and start_url correctly when Etherpad is
 * proxied under a subpath.
 */

const common = require('../common');
import settings from 'ep_etherpad-lite/node/utils/Settings';

let agent: any;

describe(__filename, function () {
  before(async function () { agent = await common.init(); });

  describe('/manifest.json without proxy headers', function () {
    it('emits leading-slash icon srcs and start_url=/', async function () {
      const res = await agent.get('/manifest.json').expect(200);
      const m = res.body;
      if (m.start_url !== '/') {
        throw new Error(`expected start_url "/", got ${JSON.stringify(m.start_url)}`);
      }
      const srcs = (m.icons || []).map((i: any) => i.src);
      for (const s of srcs) {
        if (!s.startsWith('/')) {
          throw new Error(`expected leading-slash icon src, got ${s}`);
        }
      }
    });
  });

  describe('/manifest.json with x-proxy-path', function () {
    it('prefixes every icon src and start_url', async function () {
      const res = await agent.get('/manifest.json')
          .set('x-proxy-path', '/sub')
          .expect(200);
      const m = res.body;
      if (m.start_url !== '/sub/') {
        throw new Error(`expected start_url "/sub/", got ${JSON.stringify(m.start_url)}`);
      }
      const srcs = (m.icons || []).map((i: any) => i.src);
      for (const s of srcs) {
        if (!s.startsWith('/sub/')) {
          throw new Error(`expected /sub/-prefixed icon src, got ${s}`);
        }
      }
    });

    it('sets Vary so caches don\'t collapse responses across prefixes', async function () {
      const res = await agent.get('/manifest.json')
          .set('x-proxy-path', '/sub')
          .expect(200);
      const vary = (res.headers.vary || '').toLowerCase();
      if (!vary.includes('x-proxy-path')) {
        throw new Error(`expected Vary to include x-proxy-path, got ${vary}`);
      }
    });
  });

  describe('/manifest.json with x-ingress-path (HA)', function () {
    it('ignores the header when trustProxy is off', async function () {
      const original = settings.trustProxy;
      settings.trustProxy = false;
      try {
        const res = await agent.get('/manifest.json')
            .set('x-ingress-path', '/api/hassio_ingress/abc')
            .expect(200);
        if (res.body.start_url !== '/') {
          throw new Error(`expected start_url "/" when trustProxy=false, got ${res.body.start_url}`);
        }
      } finally {
        settings.trustProxy = original;
      }
    });

    it('honors the header when trustProxy is on', async function () {
      const original = settings.trustProxy;
      settings.trustProxy = true;
      try {
        const res = await agent.get('/manifest.json')
            .set('x-ingress-path', '/api/hassio_ingress/abc')
            .expect(200);
        if (res.body.start_url !== '/api/hassio_ingress/abc/') {
          throw new Error(`expected prefixed start_url, got ${res.body.start_url}`);
        }
      } finally {
        settings.trustProxy = original;
      }
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter ./src test -- --grep pwaManifest
```

Expected: 3-4 failures saying start_url is `/` not `/sub/` (or similar), and Vary header missing.

- [ ] **Step 3: Update `pwa.ts` to honor proxyPath**

Replace `src/node/hooks/express/pwa.ts` with:

```typescript
import {ArgsExpressType} from "../../types/ArgsExpressType";
import settings from '../../utils/Settings';
import {sanitizeProxyPath} from '../../utils/sanitizeProxyPath';

const buildManifest = (proxyPath: string) => ({
  name: settings.title || "Etherpad",
  short_name: settings.title,
  description: "A collaborative online editor",
  icons: [
    {
      "src": `${proxyPath}/static/skins/colibris/images/fond.jpg`,
      "sizes": "512x512",
      "type": "image/png",
    },
    {
      "src": `${proxyPath}/favicon.ico`,
      "sizes": "64x64 32x32 24x24 16x16",
      type: "image/png",
    },
  ],
  start_url: `${proxyPath}/`,
  display: "fullscreen",
  theme_color: "#0f775b",
  background_color: "#0f775b",
});

exports.expressCreateServer = (hookName:string, args:ArgsExpressType, cb:Function) => {
  args.app.get('/manifest.json', (req:any, res:any) => {
    const proxyPath = sanitizeProxyPath(req);
    if (proxyPath) {
      // Same pattern as admin.ts: caches must not collapse responses
      // across requests that arrived with different prefix headers.
      res.setHeader('Vary', 'x-proxy-path, x-forwarded-prefix, x-ingress-path');
      res.setHeader('Cache-Control', 'private, no-store');
    }
    res.json(buildManifest(proxyPath));
  });

  return cb();
};
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter ./src test -- --grep pwaManifest
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/node/hooks/express/pwa.ts src/tests/backend/specs/pwaManifest.ts
git commit -m "feat(pwa): make /manifest.json honor sanitised proxy-path (#7802)"
```

---

## Task 3: Make `socialMeta.buildAbsoluteUrl` honor proxyPath

**Files:**
- Modify: `src/node/utils/socialMeta.ts`
- Modify: `src/tests/backend/specs/socialMeta-unit.ts`
- Modify: `src/node/hooks/express/specialpages.ts` (call sites)

### Background

`socialMeta.renderSocialMeta` calls `buildAbsoluteUrl(req, pathname, publicURL)` for `og:url` and `og:image`. When `publicURL` is set it's used verbatim (correct behaviour). When `publicURL` is null, the URL is built from the request's protocol+host with the bare `pathname`. Under a proxy with a path prefix, the prefix must be inserted.

The fix is local to `buildAbsoluteUrl` (and its only-internal caller `resolveImageUrl`): they grow an explicit `proxyPath` parameter. `renderSocialMeta` reads `proxyPath` from `RenderOpts` and threads it down. `publicURL` precedence is unchanged.

### Steps

- [ ] **Step 1: Write the failing tests**

Append to the `describe(__filename, ...)` block in `src/tests/backend/specs/socialMeta-unit.ts` (the file already imports `renderSocialMeta`, `buildSocialMetaHtml`, etc. — reuse those imports):

```typescript
  describe('renderSocialMeta — proxyPath fallback (no publicURL)', function () {
    const mkReq = (overrides: Record<string, any> = {}) => ({
      protocol: 'https',
      get: (n: string) => n.toLowerCase() === 'host' ? 'pad.example' : undefined,
      acceptsLanguages: () => 'en',
      originalUrl: '/p/scratch',
      ...overrides,
    });

    it('prefixes og:url with proxyPath when publicURL is null', function () {
      const out = renderSocialMeta({
        req: mkReq() as any,
        settings: {title: 'Etherpad', favicon: null, publicURL: null},
        availableLangs: {en: {}},
        locales: {en: {}},
        kind: 'pad',
        padName: 'scratch',
        proxyPath: '/api/hassio_ingress/abc',
      });
      if (!out.includes('content="https://pad.example/api/hassio_ingress/abc/p/scratch"')) {
        throw new Error(`og:url missing proxyPath prefix:\n${out}`);
      }
    });

    it('prefixes og:image with proxyPath when publicURL is null and favicon is not an absolute URL', function () {
      const out = renderSocialMeta({
        req: mkReq() as any,
        settings: {title: 'Etherpad', favicon: null, publicURL: null},
        availableLangs: {en: {}},
        locales: {en: {}},
        kind: 'pad',
        padName: 'scratch',
        proxyPath: '/sub',
      });
      if (!out.includes('content="https://pad.example/sub/favicon.ico"')) {
        throw new Error(`og:image missing proxyPath prefix:\n${out}`);
      }
    });

    it('publicURL still wins over proxyPath when both are set', function () {
      const out = renderSocialMeta({
        req: mkReq() as any,
        settings: {
          title: 'Etherpad',
          favicon: null,
          publicURL: 'https://pad.canonical.example',
        },
        availableLangs: {en: {}},
        locales: {en: {}},
        kind: 'pad',
        padName: 'scratch',
        proxyPath: '/sub',
      });
      if (!out.includes('content="https://pad.canonical.example/p/scratch"')) {
        throw new Error(`publicURL should win over proxyPath:\n${out}`);
      }
      if (out.includes('/sub/')) {
        throw new Error(`proxyPath leaked into URL when publicURL was set:\n${out}`);
      }
    });

    it('proxyPath default of "" produces today\'s URL shape', function () {
      const out = renderSocialMeta({
        req: mkReq() as any,
        settings: {title: 'Etherpad', favicon: null, publicURL: null},
        availableLangs: {en: {}},
        locales: {en: {}},
        kind: 'pad',
        padName: 'scratch',
        // proxyPath omitted
      });
      if (!out.includes('content="https://pad.example/p/scratch"')) {
        throw new Error(`default URL shape regressed:\n${out}`);
      }
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter ./src test -- --grep "proxyPath fallback"
```

Expected: 4 failures (RenderOpts has no proxyPath field; URLs don't include prefix).

- [ ] **Step 3: Update `socialMeta.ts` to thread proxyPath through**

In `src/node/utils/socialMeta.ts`:

3a. Update `buildAbsoluteUrl` signature and body. Replace the existing function:

```typescript
const buildAbsoluteUrl = (
  req: Request, pathname: string, publicURL: string | null | undefined,
  proxyPath: string,
): string => {
  const trusted = sanitizePublicURL(publicURL);
  if (trusted) return `${trusted}${pathname}`;
  const proto = req.protocol === 'https' ? 'https' : 'http';
  const host = sanitizeHost(req.get && req.get('host')) || 'localhost';
  return `${proto}://${host}${proxyPath}${pathname}`;
};
```

3b. Update `resolveImageUrl` to accept and forward proxyPath:

```typescript
const resolveImageUrl = (
  req: Request, faviconSetting: string | null | undefined, publicURL: string | null | undefined,
  proxyPath: string,
): string => {
  if (faviconSetting && /^https?:\/\//i.test(faviconSetting)) return faviconSetting;
  return buildAbsoluteUrl(req, '/favicon.ico', publicURL, proxyPath);
};
```

3c. Extend `RenderOpts`:

```typescript
export type RenderOpts = {
  req: Request,
  settings: SocialMetaSettings,
  availableLangs: AvailableLangs,
  locales: {[lang: string]: {[key: string]: string}},
  kind: 'pad' | 'timeslider' | 'home',
  padName?: string,
  // URL-path prefix Etherpad is being served under (`''` when running at root).
  // When set, used as a path prefix for from-request fallback URLs. Ignored
  // when settings.publicURL is configured (publicURL encodes the canonical
  // origin and any path component the operator wants).
  proxyPath?: string,
};
```

3d. In `renderSocialMeta`, read `proxyPath` once and thread it:

```typescript
export const renderSocialMeta = (o: RenderOpts): string => {
  const renderLang = negotiateRenderLang(o.req, o.availableLangs);
  const siteName = o.settings.title || 'Etherpad';
  const description = resolveDescriptionWithOverride(
      o.settings.socialMeta && o.settings.socialMeta.description,
      o.locales, renderLang);
  const proxyPath = o.proxyPath || '';
  const imageUrl = resolveImageUrl(o.req, o.settings.favicon, o.settings.publicURL, proxyPath);
  const imageAlt = `${siteName} logo`;

  let title = siteName;
  let pathname = (o.req && o.req.originalUrl) || '/';
  if (o.padName) {
    if (o.kind === 'pad') title = `${o.padName} | ${siteName}`;
    else if (o.kind === 'timeslider') title = `${o.padName} (history) | ${siteName}`;
  }
  const qIdx = pathname.indexOf('?');
  if (qIdx >= 0) pathname = pathname.slice(0, qIdx);

  return buildSocialMetaHtml({
    url: buildAbsoluteUrl(o.req, pathname, o.settings.publicURL, proxyPath),
    siteName,
    title,
    description,
    imageUrl,
    imageAlt,
    renderLang,
  });
};
```

Note: `req.originalUrl` already includes the path AS SEEN BY ETHERPAD (i.e. the proxy has already stripped the prefix). So we prepend `proxyPath` to recover the public path.

- [ ] **Step 4: Update specialpages.ts call sites to pass proxyPath**

In `src/node/hooks/express/specialpages.ts`, find each call to `renderSocialMeta(...)` and add `proxyPath` to the options. There are 3 call sites in the current code; the pattern at each is:

```typescript
const proxyPath = sanitizeProxyPath(req);  // already present
const socialMetaHtml = renderSocialMeta({
  req, settings, availableLangs: i18n.availableLangs, locales: i18n.locales,
  kind: 'pad', padName: req.params.pad,
  proxyPath,                                  // <-- add this line
});
```

Apply at lines ~204, ~246, and the home-page render (search for `renderSocialMeta` in the file).

- [ ] **Step 5: Run tests to verify they pass**

```bash
pnpm --filter ./src test -- --grep "socialMeta"
```

Expected: all socialMeta tests pass (new ones + existing).

- [ ] **Step 6: Commit**

```bash
git add src/node/utils/socialMeta.ts \
        src/tests/backend/specs/socialMeta-unit.ts \
        src/node/hooks/express/specialpages.ts
git commit -m "feat(social-meta): honor proxyPath in from-request og:url and og:image (#7802)"
```

---

## Task 4: Fix leading-slash URLs in `index.html`

**Files:**
- Modify: `src/templates/index.html`
- Modify: `src/node/hooks/express/specialpages.ts` (pass `proxyPath` to the template render)

### Steps

- [ ] **Step 1: Update the route handler to pass proxyPath**

In `src/node/hooks/express/specialpages.ts`, find each `eejs.require('ep_etherpad-lite/templates/index.html', {...})` call (there are 2 — one in the dev-watch path around line 179, one in the production path around line 369). Add `proxyPath` to the render context (computed already as `proxyPath = sanitizeProxyPath(req)` just above each call — confirm in code, add the call if missing for the production path):

```typescript
// Around line 175-179 (dev/watch path):
const proxyPath = sanitizeProxyPath(req);
const socialMetaHtml = renderSocialMeta({...});
res.send(eejs.require('ep_etherpad-lite/templates/index.html', {
  req, entrypoint: proxyPath + '/watch/index?hash=' + hash, settings, socialMetaHtml,
  proxyPath,                              // <-- add
}));

// Around line 369 (prod path):
const proxyPath = sanitizeProxyPath(req); // add if not present
res.send(eejs.require('ep_etherpad-lite/templates/index.html', {
  req, settings, entrypoint: "./"+fileNameIndex, socialMetaHtml,
  proxyPath,                              // <-- add
}));
```

- [ ] **Step 2: Update `src/templates/index.html` to use proxyPath**

Replace line 13:

```html
        <link rel="manifest" href="/manifest.json" />
```

with:

```html
        <link rel="manifest" href="<%= typeof proxyPath !== 'undefined' ? proxyPath : '' %>/manifest.json" />
```

Replace line 251:

```html
        <div style="display:none"><a href="/javascript" data-jslicense="1">JavaScript license information</a></div>
```

with:

```html
        <div style="display:none"><a href="<%= typeof proxyPath !== 'undefined' ? proxyPath : '' %>/javascript" data-jslicense="1">JavaScript license information</a></div>
```

(Using `typeof proxyPath !== 'undefined'` rather than `proxyPath ||` so that an explicit empty-string `proxyPath` doesn't surprise us either way — same value, but defensive against future template reuse.)

- [ ] **Step 3: Manual smoke**

```bash
pnpm --filter ./src run dev &
DEV_PID=$!
sleep 5
# Without proxy header — assert no regression
curl -s http://127.0.0.1:9001/ | grep -E 'rel="manifest"|jslicense'
# Expected: href="/manifest.json"  and  href="/javascript"
curl -s -H 'x-proxy-path: /sub' http://127.0.0.1:9001/ | grep -E 'rel="manifest"|jslicense'
# Expected: href="/sub/manifest.json"  and  href="/sub/javascript"
kill $DEV_PID
```

- [ ] **Step 4: Commit**

```bash
git add src/templates/index.html src/node/hooks/express/specialpages.ts
git commit -m "feat(templates): index.html manifest + jslicense links honor proxyPath (#7802)"
```

---

## Task 5: Fix leading-slash and buggy-relative URLs in `pad.html`

**Files:**
- Modify: `src/templates/pad.html`
- Modify: `src/node/hooks/express/specialpages.ts` (pass `proxyPath` to pad template render — likely already passed via Task 3 since the pad route already calls `sanitizeProxyPath(req)`; confirm)

### Background

`pad.html` is mostly already prefix-correct because its asset URLs are relative (e.g. `../static/css/pad.css`). Three exceptions:

1. `<link rel="manifest" href="../../manifest.json">` — one `..` too many. Resolves to `/manifest.json` from BOTH `/p/test` and `/sub/p/test` (the extra `..` is silently capped at root). Under a prefix, it should be `/sub/manifest.json`. Fix: drop one `..` → `../manifest.json`.
2. `<form action="/ep/pad/reconnect">` — leading slash, needs `proxyPath`.
3. `<a href="/javascript">` (jslicense) — leading slash, needs `proxyPath`.

NO `<base href>` is added: it would not help plugin-injected leading-slash URLs (path-absolute URLs ignore `<base>`'s path) AND it would break the existing `..`-based relative URLs in this template.

### Steps

- [ ] **Step 1: Confirm proxyPath is in the pad.html render context**

Open `src/node/hooks/express/specialpages.ts` and locate the pad route handler around line 193-216. After Task 3 it already has `const proxyPath = sanitizeProxyPath(req)` and passes `proxyPath` to `renderSocialMeta(...)`. Add `proxyPath` to the `eejs.require('.../pad.html', {...})` options dict if not already present:

```typescript
const content = eejs.require('ep_etherpad-lite/templates/pad.html', {
  req,
  toolbar,
  isReadOnly,
  entrypoint: proxyPath + '/watch/pad?hash=' + hash,
  settings: settings.getPublicSettings(),
  socialMetaHtml,
  proxyPath,                              // <-- add if missing
})
```

Same change for the production-path pad render around line 387.

- [ ] **Step 2: Fix the manifest `..`-count bug**

In `src/templates/pad.html`, change line 23:

```diff
- <link rel="manifest" href="../../manifest.json" />
+ <link rel="manifest" href="../manifest.json" />
```

Rationale: the pad URL is `/p/:pad` (no trailing slash; directory is `/p/`). From `/p/`, `../manifest.json` → `/manifest.json` ✓ (root case). From `/sub/p/`, `../manifest.json` → `/sub/manifest.json` ✓ (prefix case). The previous value `../../manifest.json` capped at root in both cases.

- [ ] **Step 3: Make the reconnect form action proxyPath-aware**

Replace line ~518:

```diff
- <form id="reconnectform" method="post" action="/ep/pad/reconnect" accept-charset="UTF-8" style="display: none;">
+ <form id="reconnectform" method="post" action="<%= typeof proxyPath !== 'undefined' ? proxyPath : '' %>/ep/pad/reconnect" accept-charset="UTF-8" style="display: none;">
```

- [ ] **Step 4: Make the jslicense link proxyPath-aware**

Replace line ~665:

```diff
- <div style="display:none"><a href="/javascript" data-jslicense="1">JavaScript license information</a></div>
+ <div style="display:none"><a href="<%= typeof proxyPath !== 'undefined' ? proxyPath : '' %>/javascript" data-jslicense="1">JavaScript license information</a></div>
```

- [ ] **Step 5: Manual smoke**

```bash
pnpm --filter ./src run dev &
DEV_PID=$!
sleep 5
# Without proxy — confirm no regression:
curl -s http://127.0.0.1:9001/p/test | grep -E 'rel="manifest"|reconnectform|jslicense'
# Expected:
#   href="../manifest.json"  (was ../../manifest.json)
#   action="/ep/pad/reconnect"
#   href="/javascript"
# With proxy:
curl -s -H 'x-proxy-path: /sub' http://127.0.0.1:9001/p/test | grep -E 'rel="manifest"|reconnectform|jslicense'
# Expected:
#   href="../manifest.json"  (unchanged; browser will resolve to /sub/manifest.json)
#   action="/sub/ep/pad/reconnect"
#   href="/sub/javascript"
kill $DEV_PID
```

- [ ] **Step 6: Commit**

```bash
git add src/templates/pad.html src/node/hooks/express/specialpages.ts
git commit -m "feat(templates): pad.html reconnect/jslicense honor proxyPath; fix manifest .. count (#7802)"
```

---

## Task 6: Fix leading-slash and buggy-relative URLs in `timeslider.html`

**Files:**
- Modify: `src/templates/timeslider.html`
- Modify: `src/node/hooks/express/specialpages.ts` (confirm proxyPath threaded)

### Background

Timeslider URL is `/p/:pad/timeslider` (directory `/p/:pad/`). Line 38 has `<link rel="manifest" href="../../../manifest.json">` — one `..` too many; from `/p/test/timeslider` resolves to `/manifest.json` (cap-at-root); from `/sub/p/test/timeslider` ALSO resolves to `/manifest.json` (wrong; should be `/sub/manifest.json`). Drop one `..` → `../../manifest.json`. Same rationale as Task 5.

Also fix the same two leading-slash URLs as in pad.html (reconnect form, jslicense link). No `<base href>` added.

### Steps

- [ ] **Step 1: Confirm proxyPath is in the timeslider render context**

Locate the timeslider route handler around line 228-259 of `specialpages.ts`. After Task 3, `proxyPath` is already used for the social-meta call. Add it to the `eejs.require('.../timeslider.html', {...})` options dict if it isn't already present (and to the production-path timeslider render around line 420).

- [ ] **Step 2: Fix the manifest `..`-count bug**

In `src/templates/timeslider.html`, change line 38:

```diff
- <link rel="manifest" href="../../../manifest.json" />
+ <link rel="manifest" href="../../manifest.json" />
```

Rationale identical to Task 5 — one fewer `..` correctly handles both root- and prefix-mount cases.

- [ ] **Step 3: Make the reconnect form action proxyPath-aware**

Replace line ~223:

```diff
- <form id="reconnectform" method="post" action="/ep/pad/reconnect" accept-charset="UTF-8" style="display: none;">
+ <form id="reconnectform" method="post" action="<%= typeof proxyPath !== 'undefined' ? proxyPath : '' %>/ep/pad/reconnect" accept-charset="UTF-8" style="display: none;">
```

- [ ] **Step 4: Make the jslicense link proxyPath-aware**

Replace line ~283:

```diff
- <div style="display:none"><a href="/javascript" data-jslicense="1">JavaScript license information</a></div>
+ <div style="display:none"><a href="<%= typeof proxyPath !== 'undefined' ? proxyPath : '' %>/javascript" data-jslicense="1">JavaScript license information</a></div>
```

- [ ] **Step 5: Manual smoke**

```bash
pnpm --filter ./src run dev &
DEV_PID=$!
sleep 5
curl -s 'http://127.0.0.1:9001/p/test/timeslider?embed=1' | grep -E 'rel="manifest"|reconnectform|jslicense'
# Expected:
#   href="../../manifest.json"  (was ../../../manifest.json)
#   action="/ep/pad/reconnect"
#   href="/javascript"
curl -s -H 'x-proxy-path: /sub' 'http://127.0.0.1:9001/p/test/timeslider?embed=1' | grep -E 'rel="manifest"|reconnectform|jslicense'
# Expected:
#   href="../../manifest.json"  (browser resolves to /sub/manifest.json)
#   action="/sub/ep/pad/reconnect"
#   href="/sub/javascript"
kill $DEV_PID
```

- [ ] **Step 6: Commit**

```bash
git add src/templates/timeslider.html src/node/hooks/express/specialpages.ts
git commit -m "feat(templates): timeslider.html reconnect/jslicense honor proxyPath; fix manifest .. count (#7802)"
```

---

## Task 7: Fix leading-slash URL in `export_html.html`

**Files:**
- Modify: `src/templates/export_html.html`
- Modify: the export-HTML route handler (find via grep)

### Steps

- [ ] **Step 1: Locate the route handler that renders `export_html.html`**

```bash
grep -rn "export_html.html\|exportHtml" src/node/ 2>/dev/null
```

Expected: a handler in `src/node/hooks/express/importexport.ts` or `src/node/utils/ExportHtml.ts`. Open it and locate the `eejs.require('ep_etherpad-lite/templates/export_html.html', {...})` call.

- [ ] **Step 2: Decide whether export-HTML SHOULD honor proxyPath**

Exported HTML is downloaded by the user and viewed off-Etherpad (saved to disk, attached to email, etc.). The manifest link is dead-weight in an offline file. Two options:

  (a) Honor proxyPath — keeps consistency, exported file references the source server's manifest when opened in a browser pointed at it.
  (b) Just remove the manifest tag from the exported file — it serves no purpose in a standalone HTML snapshot.

Pick (a) for minimum change. Pass `proxyPath = sanitizeProxyPath(req)` into the render context (or `''` if the export handler has no `req` available — e.g. when called from a CLI export).

If the export handler doesn't have a `req` (i.e. exports happen via the API without a per-request `proxyPath` to read from): pass `proxyPath = ''` and accept that exported HTML always carries `/manifest.json`. Note this in the commit message.

- [ ] **Step 3: Update `src/templates/export_html.html` line 5**

Replace:

```html
  <link rel="manifest" href="/manifest.json" />
```

with:

```html
  <link rel="manifest" href="<%= typeof proxyPath !== 'undefined' ? proxyPath : '' %>/manifest.json" />
```

- [ ] **Step 4: Update the export handler to pass `proxyPath`** (if a `req` is in scope; otherwise rely on the EJS default `''`).

Example pattern (only if `req` is in scope):

```typescript
const proxyPath = sanitizeProxyPath(req);
const out = eejs.require('ep_etherpad-lite/templates/export_html.html', {
  ...existingArgs,
  proxyPath,
});
```

- [ ] **Step 5: Commit**

```bash
git add src/templates/export_html.html src/node/hooks/express/importexport.ts \
        src/node/utils/ExportHtml.ts 2>/dev/null
git commit -m "feat(templates): export_html.html manifest honors proxyPath when available (#7802)"
```

(Drop any file from the `git add` that wasn't actually modified — git will skip it.)

---

## Task 8: Backend integration test — single supertest GET asserts everything

**Files:**
- Test: `src/tests/backend/specs/urlBasePath.ts` *(new)*

### Steps

- [ ] **Step 1: Write the integration test**

Create `src/tests/backend/specs/urlBasePath.ts`:

```typescript
'use strict';

/**
 * End-to-end coverage for X-Forwarded-Prefix / X-Ingress-Path support (#7802).
 *
 * Verifies that across the public surfaces:
 *   - /
 *   - /p/:pad
 *   - /manifest.json
 *
 * a single sanitised proxy-path is reflected consistently in the
 * rendered HTML and JSON: <base href>, manifest link, og:url,
 * og:image, manifest start_url, manifest icon srcs.
 *
 * Also verifies the no-header case still produces today's output
 * (regression guard).
 */

const common = require('../common');
import settings from 'ep_etherpad-lite/node/utils/Settings';

let agent: any;

const expectHas = (haystack: string, needle: string, label: string) => {
  if (!haystack.includes(needle)) {
    throw new Error(`expected ${label} to include ${JSON.stringify(needle)}.\n--- got ---\n${haystack.slice(0, 800)}\n...`);
  }
};

const expectMisses = (haystack: string, needle: string, label: string) => {
  if (haystack.includes(needle)) {
    throw new Error(`${label} should not include ${JSON.stringify(needle)}.\n--- got ---\n${haystack.slice(0, 800)}\n...`);
  }
};

describe(__filename, function () {
  before(async function () { agent = await common.init(); });

  describe('no proxy headers — backwards compatibility', function () {
    it('/ renders today\'s URLs', async function () {
      const res = await agent.get('/').expect(200);
      expectHas(res.text, 'href="/manifest.json"', 'index manifest link');
    });

    it('/p/:pad renders today\'s URLs', async function () {
      const res = await agent.get('/p/UrlBasePathTest').expect(200);
      expectHas(res.text, 'action="/ep/pad/reconnect"', 'reconnect form action');
      expectHas(res.text, 'href="../manifest.json"', 'manifest link (relative form)');
    });

    it('/manifest.json returns root-relative paths', async function () {
      const res = await agent.get('/manifest.json').expect(200);
      if (res.body.start_url !== '/') {
        throw new Error(`expected "/", got ${res.body.start_url}`);
      }
    });
  });

  describe('with x-proxy-path: /sub', function () {
    const headers = {'x-proxy-path': '/sub'};

    it('/ has /sub-prefixed manifest link', async function () {
      const res = await agent.get('/').set(headers).expect(200);
      expectHas(res.text, 'href="/sub/manifest.json"', 'index manifest link');
      expectMisses(res.text, 'href="/manifest.json"', 'unprefixed manifest link');
    });

    it('/p/:pad reconnect form action carries the prefix', async function () {
      const res = await agent.get('/p/UrlBasePathTest').set(headers).expect(200);
      expectHas(res.text, 'action="/sub/ep/pad/reconnect"', 'reconnect form action');
      // The manifest <link> stays relative (../manifest.json); browser resolves
      // it to /sub/manifest.json based on the request URL — we assert the
      // template emits the relative form unchanged.
      expectHas(res.text, 'href="../manifest.json"', 'manifest link (relative form)');
    });

    it('/p/:pad og:url and og:image carry the prefix', async function () {
      const res = await agent.get('/p/UrlBasePathTest').set(headers).expect(200);
      expectHas(res.text, '/sub/p/UrlBasePathTest', 'og:url path');
      expectHas(res.text, '/sub/favicon.ico', 'og:image path');
    });

    it('/manifest.json has /sub-prefixed start_url and icon srcs', async function () {
      const res = await agent.get('/manifest.json').set(headers).expect(200);
      if (res.body.start_url !== '/sub/') {
        throw new Error(`expected /sub/, got ${res.body.start_url}`);
      }
      for (const icon of res.body.icons) {
        if (!icon.src.startsWith('/sub/')) {
          throw new Error(`icon src missing prefix: ${icon.src}`);
        }
      }
    });
  });

  describe('with x-ingress-path under trustProxy', function () {
    const headers = {'x-ingress-path': '/api/hassio_ingress/abc'};
    let originalTrust: boolean;

    before(function () {
      originalTrust = settings.trustProxy;
      settings.trustProxy = true;
    });
    after(function () { settings.trustProxy = originalTrust; });

    it('/p/:pad picks up the HA ingress prefix in the reconnect form action', async function () {
      const res = await agent.get('/p/UrlBasePathTest').set(headers).expect(200);
      expectHas(res.text, 'action="/api/hassio_ingress/abc/ep/pad/reconnect"', 'reconnect form action');
    });

    it('/manifest.json picks up the HA ingress prefix', async function () {
      const res = await agent.get('/manifest.json').set(headers).expect(200);
      if (res.body.start_url !== '/api/hassio_ingress/abc/') {
        throw new Error(`expected /api/hassio_ingress/abc/, got ${res.body.start_url}`);
      }
    });
  });

  describe('with x-ingress-path WITHOUT trustProxy', function () {
    const headers = {'x-ingress-path': '/api/hassio_ingress/abc'};

    it('header is ignored — output is today\'s', async function () {
      // setUp guarantees trustProxy starts at its default (false) — see common.init
      const res = await agent.get('/p/UrlBasePathTest').set(headers).expect(200);
      expectHas(res.text, 'action="/ep/pad/reconnect"', 'unprefixed reconnect form action');
      expectMisses(res.text, '/api/hassio_ingress/', 'leaked ingress prefix');
    });
  });
});
```

- [ ] **Step 2: Run the integration test**

```bash
pnpm --filter ./src test -- --grep urlBasePath
```

Expected: all tests pass. If any fails, identify whether it's a missed call site (Tasks 4-7) or a deeper miss (Tasks 1-3) and patch the relevant step.

- [ ] **Step 3: Commit**

```bash
git add src/tests/backend/specs/urlBasePath.ts
git commit -m "test: end-to-end coverage for X-Forwarded-Prefix / X-Ingress-Path (#7802)"
```

---

## Task 9: Documentation

**Files:**
- Modify: `src/node/utils/Settings.ts` (doc comment for `trustProxy`)
- Modify: `settings.json.template` (doc comment for `trustProxy`)

### Steps

- [ ] **Step 1: Update the Settings.ts doc comment for `trustProxy`**

Find the comment above `trustProxy: false` (around line 677-680) and replace with:

```typescript
  /**
   * Trust Proxy, whether or not trust the x-forwarded-for header.
   *
   * Setting this to `true` also makes Etherpad honor two standard URL-path-
   * prefix headers from upstream proxies:
   *   - `X-Forwarded-Prefix` (HAProxy / Traefik convention)
   *   - `X-Ingress-Path` (Home Assistant supervisor ingress)
   *
   * Both are sanitised before use (see src/node/utils/sanitizeProxyPath.ts).
   * Etherpad's own `x-proxy-path` header is honored regardless of this
   * setting; the operator is presumed to have configured their proxy
   * intentionally when sending the custom header.
   */
  trustProxy: false,
```

- [ ] **Step 2: Update `settings.json.template`**

Find the `trustProxy` block and update its comment block in the same way (matching the file's existing comment style — usually `/* ... */` JSON-with-comments).

- [ ] **Step 3: Commit**

```bash
git add src/node/utils/Settings.ts settings.json.template
git commit -m "docs(settings): trustProxy also enables X-Forwarded-Prefix / X-Ingress-Path (#7802)"
```

---

## Task 10: Verification before completion

**Files:** none (validation only)

### Steps

- [ ] **Step 1: Full backend test suite**

```bash
pnpm --filter ./src test
```

Expected: all tests pass (no regressions in any unrelated spec).

- [ ] **Step 2: Vitest backend-new suite**

```bash
pnpm --filter ./src test:vitest
```

Expected: all tests pass.

- [ ] **Step 3: TypeScript check**

```bash
pnpm --filter ./src run tsc --noEmit
```

Expected: no errors. (If errors are pre-existing on develop, isolate and confirm they aren't new.)

- [ ] **Step 4: Manual smoke through a path-prefix proxy**

Start a tiny nginx (or `caddy reverse-proxy`) in front of the dev server:

```bash
# Option A — caddy one-liner:
caddy reverse-proxy --from :9002 --to 127.0.0.1:9001 \
  --header-up 'X-Forwarded-Prefix: /sub' &
# (caddy strips path; we want it to KEEP the path, so prefer nginx for fidelity)

# Option B — minimal nginx.conf snippet:
# location /sub/ {
#   proxy_set_header X-Forwarded-Prefix /sub;
#   proxy_pass http://127.0.0.1:9001/;
# }
```

Then open `http://127.0.0.1:9002/sub/p/manual-smoke` in a browser. Confirm:
  - Pad loads, toolbar renders.
  - Inner ace iframe renders text.
  - WebSocket connects (check network panel: `/sub/socket.io/...`).
  - Toolbar plugin features (alignment, headings) actually apply visual changes — this was the original symptom in #7802.
  - Open `/sub/admin/` — admin SPA loads and its left-nav links work.
  - Open `/sub/manifest.json` — paths in icons + start_url all prefixed.
  - View source on the pad — `href="../manifest.json"` (browser resolves to `/sub/manifest.json`), `action="/sub/ep/pad/reconnect"`, `href="/sub/javascript"` for the jslicense link.

- [ ] **Step 5: Open the PR**

```bash
git push -u origin feat/url-base-path-7802
gh pr create --base develop \
  --title "feat: support X-Forwarded-Prefix and X-Ingress-Path (#7802)" \
  --body "$(cat <<'EOF'
## Summary

- Extends `sanitizeProxyPath` to honor `X-Forwarded-Prefix` and `X-Ingress-Path` in addition to the existing `x-proxy-path`, gated on `settings.trustProxy === true`.
- Makes `/manifest.json` (icon `src`, `start_url`) prefix-aware.
- Makes `socialMeta` (`og:url`, `og:image`) prefix-aware when falling back to from-request origin (`publicURL` still wins).
- Touches up the remaining leading-slash URLs in `index.html`, `pad.html`, `timeslider.html`, `export_html.html`.
- Injects `<base href>` in pad/timeslider HTML so plugin-injected leading-slash URLs route through the prefix without per-plugin opt-in.

Closes #7802.

## Test plan

- [ ] `pnpm --filter ./src test` passes
- [ ] `pnpm --filter ./src test:vitest` passes
- [ ] Manual smoke through an nginx subpath proxy: pad loads, plugin features apply visually, admin SPA reachable, manifest icons resolve.
- [ ] Manual smoke through the Home Assistant ingress addon (deferred to next addon release candidate).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

After the PR is open, check CI within ~20s and address any failures before declaring complete (per `feedback_check_ci_after_pr`).

---

## Notes for the executor

- Every template change is gated behind a `typeof proxyPath !== 'undefined'` check. This is defensive: if a plugin or future code path renders one of these templates without passing `proxyPath`, the output silently degrades to today's behaviour rather than throwing.
- **Do NOT add a `<base href>` tag.** This was considered and rejected — see the spec's Risks section. `<base href>` does not catch plugin-injected leading-slash URLs (path-absolute URLs deliberately ignore the path component of `<base>`) and it would break the existing `../static/...` relative URLs in pad.html / timeslider.html.
- The manifest `..`-count fix in Tasks 5 and 6 (`../../manifest.json` → `../manifest.json`; `../../../manifest.json` → `../../manifest.json`) is a strict improvement: same value at root mount, correct value under a prefix. No behaviour change for non-proxied users.
- Don't touch `src/static/js/pad.ts`, `padBootstrap.js`, or `socketio.ts`. They already derive `baseURL` from `window.location` and are prefix-aware.
- Don't touch `admin/vite.config.ts` or rebuild the admin SPA. `src/node/hooks/express/admin.ts` already rewrites `/admin` and `/socket.io` strings in the served admin HTML when `proxyPath` is non-empty — that mechanism picks up the new header sources automatically once Task 1 lands.
- Resist the temptation to refactor `sanitizeProxyPath` further. Keep it a pure function with the new optional `opts.trustProxy` parameter. The settings import for the default value is the only side effect.
