# Open Graph metadata for pad pages — Design

GitHub issue: https://github.com/ether/etherpad/issues/7599

## Problem

When an Etherpad pad URL is shared in chat apps (WhatsApp, Signal, Slack,
Discord, iMessage, etc.) the link unfurls with no preview because the rendered
HTML carries no Open Graph or Twitter Card metadata. The reporter asks for
basic OG tags so shared links show a meaningful preview.

## Goals

- Pad URLs (`/p/:pad`), timeslider URLs (`/p/:pad/timeslider`), and the
  homepage (`/`) emit Open Graph + Twitter Card meta tags.
- A site operator can override the default description via `settings.json`.
- No new runtime dependencies. Implementation lives in the existing EJS
  templates and the existing settings module.

## Non-goals

- Per-pad descriptions, custom OG images per pad, or pulling content from the
  pad body. The pad text is mutable and frequently empty at first load; using
  it would be both expensive (extra DB read on a hot path) and misleading.
- A plugin hook for OG override. Defer until a plugin actually needs it
  (YAGNI).
- Removing or changing the existing `<meta name="robots" content="noindex,
  nofollow">` tag. OG unfurling is performed by chat clients that ignore
  `robots`, so the privacy posture is unchanged.

## Tags emitted

For the **pad page** (`/p/:pad`):

| Tag                 | Value                                                       |
| ------------------- | ----------------------------------------------------------- |
| `og:title`          | `{decoded pad name} | {settings.title}`                     |
| `og:description`    | `settings.socialDescription`                                |
| `og:image`          | absolute URL to `{req.protocol}://{host}/favicon.ico`*      |
| `og:url`            | absolute URL of the request                                 |
| `og:type`           | `website`                                                   |
| `og:site_name`      | `settings.title`                                            |
| `og:locale`         | negotiated `renderLang` (already computed in `pad.html`), normalized to BCP-47 with underscore (e.g. `en_US`, `de_DE`); falls back to `en_US` |
| `og:image:alt`      | `"{settings.title} logo"` (a11y — screen readers in chat clients announce this) |
| `twitter:card`      | `summary`                                                   |
| `twitter:title`     | same as `og:title`                                          |
| `twitter:description` | same as `og:description`                                  |
| `twitter:image`     | same as `og:image`                                          |
| `twitter:image:alt` | same as `og:image:alt`                                      |

\* `settings.favicon` is normally null (defaults route to the bundled
`favicon.ico` via the favicon middleware). The template builds the absolute
URL by joining `req.protocol`, `req.get('host')`, and the favicon path. If
`settings.favicon` is an absolute URL it is used verbatim.

For the **timeslider** (`/p/:pad/timeslider`): same tags, with `og:title` set
to `{decoded pad name} (history) | {settings.title}`.

For the **homepage** (`/`): same tags, with `og:title` set to
`settings.title` and `og:url` set to the request URL.

## i18n source

The description text lives in Etherpad's standard locale catalog under the
key `pad.social.description`. The shipped English default in
`src/locales/en.json` is the softer rewording of the wording in the issue:

> A collaborative document that everyone can edit in real time.

Other locale files may translate the key as the translation community picks
it up; missing translations fall back to English. **No new `settings.json`
key is added** — operators who want to override the text per-language do so
via the existing `customLocaleStrings` mechanism that Etherpad already
supports.

**Locale negotiation.** Resolution order at request time:
1. `locales[renderLang]['pad.social.description']` (exact match, where
   `renderLang` was negotiated via `req.acceptsLanguages()`).
2. `locales[primarySubtag]['pad.social.description']` (e.g. `de-AT` → `de`).
3. `locales.en['pad.social.description']` (English fallback).
4. Empty string (only if `en.json` is missing the key — should not happen
   in core).

The `i18n` hook now exports the loaded `locales` map so other server-side
modules can look up translated strings without re-reading the JSON files.

## Implementation outline

1. **Settings** — declare `socialDescription: string` on the Settings module
   with the default above; document it in both example settings files.
2. **Helper** — extract the meta-tag block into a single source of truth.
   Preferred form is an EJS partial included from each template; if
   Etherpad's `eejs` wrapper does not support `include()` cleanly, fall back
   to a small JS helper (e.g. `src/node/utils/socialMeta.ts`) exported into
   the template via the existing `eejs.require` context, returning the
   rendered `<meta>` block as a string. Implementation step 1 of the plan
   must verify which mechanism `eejs` supports before committing to one.
3. **pad.html / timeslider.html / index.html** — compute the four template
   inputs at the top of each file and `<%- include('_socialMeta', {...}) %>`
   in `<head>`, after the existing `<title>` line. The pad name is decoded
   with `decodeURIComponent(req.params.pad)` and HTML-escaped via the
   existing `<%= %>` mechanism (EJS escapes by default).
4. **Route handlers** — `specialpages.ts` already passes `req` and
   `settings` to the templates; no route changes needed.

## Tests

Add to the existing backend test suite (likely
`src/tests/backend/specs/specialpages.ts` or a new
`src/tests/backend/specs/socialmeta.ts`):

- GET `/p/TestPad-7599` → response HTML contains
  `<meta property="og:title" content="TestPad-7599 | Etherpad">` and an
  `og:description` matching the default.
- GET `/p/TestPad-7599` with `settings.socialDescription` overridden to
  `"Custom desc"` → that custom value appears in `og:description`.
- GET `/p/Has%20Space` → `og:title` contains `Has Space` (decoded) and is
  HTML-safe (no raw `%`).
- GET `/p/<script>` (encoded) → `og:title` contains escaped `&lt;script&gt;`,
  not raw HTML.
- GET `/p/TestPad/timeslider` → `og:title` contains `(history)`.
- GET `/` → `og:title` equals `settings.title`.
- GET `/p/TestPad` with `Accept-Language: de` and
  `socialDescription: {default: "X", de: "Y"}` → `og:description` is `Y`
  and `og:locale` is `de_DE` (or `de`).
- Response includes `og:image:alt` and `twitter:image:alt`.

The XSS escape test is the security-relevant one: pad IDs are user-controlled
(anyone can navigate to `/p/<anything>`).

## Risks and trade-offs

- **Pad-name leakage.** Anyone the link is shared with can already see the pad
  name in the URL, so emitting it in `og:title` does not expose anything new.
- **Caching.** OG tags are read once per unfurl. Chat clients cache aggressively;
  changing `socialDescription` will not propagate to previously-cached previews.
  This is acceptable and standard.
- **Template-set drift.** Etherpad has three top-level HTML templates that
  need OG tags; the `_socialMeta` partial avoids three copies of the same
  block.

## Out of scope (future work)

- A `padSocialMetadata` hook that lets plugins override the values.
- Per-pad description (e.g. ep_pad_title integration).
- Generated preview images (would require a rendering service).
