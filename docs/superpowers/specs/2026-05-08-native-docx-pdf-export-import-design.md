# Native DOCX + PDF export and DOCX import without LibreOffice

**Status:** spec — pending implementation
**Issue:** #7538
**Extending PR:** #7568 (`feat/native-docx-export-7538`)
**Date:** 2026-05-08

## Problem

Etherpad's import/export pipeline shells out to LibreOffice (`soffice`) for every "office" format — `pdf`, `docx`, `odt`, `doc`, `rtf`. Operators who want any of those formats must install ~500 MB of LibreOffice as a runtime dependency, plus pay subprocess latency on every export. Operators who don't want LibreOffice lose those formats entirely.

PR #7568 took a first cut at native DOCX export via `html-to-docx`, but:

- it's flag-gated (`settings.nativeDocxExport`) and falls back to soffice on error, so soffice remains a soft requirement;
- the `/export` route guard and pad UI both gate `docx` on `soffice` being configured, so the new path is unreachable in a real no-soffice deployment (Qodo finding #2);
- existing tests use `settings.soffice = 'false'` (a non-null string), which sidesteps the route guard and doesn't simulate a real no-soffice deployment (Qodo finding #3);
- the `html-to-docx` dependency tree includes `node-fetch` via `image-to-base64`, so plugin-modified HTML can trigger outbound requests from the converter (Qodo finding #4);
- nothing addresses PDF, which the issue explicitly scopes alongside DOCX.

This spec replaces the flag-gated half-measure with a soffice-first selection model, adds a native PDF export path, adds native DOCX import, and hardens both export converters against SSRF.

## Goal

A deployment with `settings.soffice = null` can:

- export pads as `html`, `txt`, `etherpad`, `docx`, `pdf` — all in-process, no subprocess, no native binaries.
- import `.html`, `.txt`, `.etherpad`, `.docx` files — all in-process.

A deployment with `settings.soffice` configured retains today's behavior bit-for-bit. There is no flag to flip; the path is chosen automatically based on `sofficeAvailable()`.

`odt`, `doc`, `rtf` (and `pdf` import) continue to require soffice. The deployment matrix is documented; users get a clear error message instead of a silent failure.

## Non-goals

- Native ODT export. No mature pure-JS writer; deferred to a follow-up issue.
- Native PDF/ODT/DOC/RTF import. No mature pure-JS readers for these in Node. Deferred.
- Pixel-perfect PDF fidelity. We target structural fidelity (paragraphs, headings, lists, tables, images, basic styling) — the same bar `html-to-docx` hits for DOCX.
- Memory/timeout caps on conversion. Pad size is already gated upstream; we'll add caps if production signal warrants it.

## Selection model

A single cascade in `ExportHandler.ts` (and a mirror in `ImportHandler`):

```text
if (sofficeAvailable() === 'yes') {
  → existing soffice path (handles all formats)
} else if (sofficeAvailable() === 'withoutPDF') {
  // Windows: soffice present but can't render PDF
  if (type === 'pdf')  → native PDF
  else                 → soffice
} else { // 'no' — soffice null
  if (type === 'docx') → native DOCX
  else if (type === 'pdf') → native PDF
  else                 → 4xx "this format requires soffice"
}
```

No fallback chain on native error. If the native converter throws, the request returns a 500 with a clear log line. This is deliberate — fallback-to-soffice is the pattern that PR #7568 originally used and that Qodo flagged as defeating the no-soffice goal.

The `nativeDocxExport` setting introduced by PR #7568 is removed entirely. With it go `NATIVE_DOCX_EXPORT`, the `doc/docker.md` row, and the new entries in `settings.json.template` / `settings.json.docker`. Native is built-in; the only thing that varies behavior is whether `soffice` is configured.

## Route guard and UI capability

`src/node/hooks/express/importexport.ts` currently rejects all of `['odt','pdf','doc','docx']` when `exportAvailable() === 'no'`. Tighten that list:

```text
if (exportAvailable() === 'no' && ['odt','doc'].includes(req.params.type)) {
  → existing "this export is not enabled" message
}
// pdf and docx fall through to ExportHandler, which dispatches per the cascade above
```

Same shape on the import endpoint: `pdf`, `odt`, `doc`, `rtf` blocked when soffice is null; `docx` (plus the pre-existing `etherpad`/`html`/`txt`) goes through.

UI side — `src/static/js/pad_impexp.ts:147-166` currently hides DOCX/PDF/ODT export links when `clientVars.exportAvailable === 'no'`. Update so:

- ODT link: visible iff `exportAvailable === 'yes'` (effectively unchanged)
- DOCX, PDF links: always visible

No new clientVars flags. The "always visible" rule reflects reality — those paths are built into core.

## Native PDF export

Module: `src/node/utils/ExportPdfNative.ts`. Single export `htmlToPdfBuffer(html: string): Promise<Buffer>`.

Approach: **`pdfkit` + `htmlparser2` + a small walker we own.** Pure JS, no jsdom, ~3 MB install footprint. We control the renderer end-to-end, so there is no SSRF surface from the converter.

### Pipeline

1. `htmlparser2` parses the input HTML into a SAX-style event stream.
2. A walker maintains a `pdfkit` document and a stack of inline-style state. Tag handling:
   - `<p>`, `<h1..h6>` — block break + font sizing
   - `<strong>`/`<b>`, `<em>`/`<i>`, `<u>`, `<s>` — toggle inline style
   - `<ul>`/`<ol>`/`<li>` — indent + bullet/number prefix
   - `<a href="…">` — underlined text + `doc.link()` annotation
   - `<br>` — `doc.moveDown(0.5)`
   - `<table>`/`<tr>`/`<td>` — best-effort grid via computed x/y on `doc.text()`. Pad HTML emits real tables only via plugins; we render what we can.
   - `<img src="data:…">` — embed via `doc.image(buffer)` after decoding the data URI
   - `<img src="…">` (any non-data URL) — replaced with the `alt=` text or skipped. **No fetch.** This is an explicit SSRF guard at the converter; the upstream sanitizer (next section) handles it too, this is defense-in-depth.
   - Unknown tags — recurse into children, ignore the wrapper
3. Buffer the PDF in memory via a `PassThrough` stream → resolve with the concatenated `Buffer`.

### Bail-out criterion

The walker is a pragmatic bet — pad HTML is constrained enough that a small walker should cover it. **If, during implementation, the walker exceeds ~500 lines of code or hits a class of pad/plugin HTML it cannot reasonably render**, switch to **Approach A**: `pdfmake` + `html-to-pdfmake` + `jsdom`. That swap keeps the same `ExportHandler.ts` integration shape — only `ExportPdfNative.ts` changes — and adds ~15–20 MB of pure-JS deps.

The plan that follows this spec must call out this decision point so the implementer doesn't grind on a dying walker.

## HTML sanitization (defense-in-depth)

New module: `src/node/utils/ExportSanitizeHtml.ts`. Single export `stripRemoteImages(html: string): string`.

Walks the HTML once with `htmlparser2`, drops any `<img>` whose `src` is not `data:` or a same-origin/relative URL. Replaces with the original `alt=` text (empty string if absent). Pure string-in/string-out, ~50 lines + a unit test.

Both export branches call this *before* handing HTML to their respective converters:

```text
const safeHtml = stripRemoteImages(html);
buffer = (type === 'docx') ? await htmlToDocx(safeHtml) : await htmlToPdfBuffer(safeHtml);
```

This addresses Qodo finding #4 against the existing DOCX path (which was always present, not introduced here) and prevents the equivalent SSRF on the PDF path.

## Native DOCX import

Module: `src/node/utils/ImportDocxNative.ts`. Single export `docxBufferToHtml(buf: Buffer): Promise<string>`.

Wraps `mammoth.convertToHtml({buffer: buf})` and returns `result.value`. Mammoth is pure JS, ~3 MB, embeds images as data URLs by default — no fetches, no SSRF surface. We pass `convertImage: mammoth.images.imgElement(...)` configured to emit data URLs only, as belt-and-braces.

Dispatch in `src/node/handler/ImportHandler.ts` mirrors the export cascade:

```text
if (sofficeAvailable() === 'yes') {
  → existing soffice path
} else if (extension === '.docx') {
  const html = await docxBufferToHtml(buffer);
  → hand to existing HTML import pipeline
} else if (['.pdf','.odt','.doc','.rtf'].includes(extension)) {
  → 4xx "this format requires soffice"
}
// .etherpad / .html / .txt unchanged on both branches
```

The HTML import pipeline already handles whatever `mammoth` emits (semantic HTML with paragraphs, lists, headings, links, inline styles, embedded images).

## Error handling

Native conversion errors surface to the client as 5xx with a logged error line that includes the pad id and format:

```text
} catch (err) {
  console.error(`native ${type} export failed for pad "${padId}":`, err);
  res.status(500).send(`Failed to export pad as ${type}.`);
}
```

No fallback chain. No silent retries.

## Tests

`src/tests/backend/specs/export.ts` — revise existing native-DOCX tests:

- Set `settings.soffice = null` (was `'false'` — fixes Qodo #3)
- Assert response is a ZIP-signature DOCX with the correct content-type
- Keep the `require.resolve('html-to-docx')` describe-skip guard for the `upgrade-from-latest-release` CI job

`src/tests/backend/specs/export.ts` — add native-PDF tests:

- With `settings.soffice = null`, GET `/p/<pad>/export/pdf` → 200, `Content-Type: application/pdf`, body starts with `%PDF-`
- Same describe-skip guard for `pdfkit` and `htmlparser2`

Negative test: with `settings.soffice = null`, GET `/p/<pad>/export/odt` still returns the "not enabled" message (proves we tightened the right gate).

`src/tests/backend/specs/export.ts` (or a sibling file) — unit test for `stripRemoteImages`:

- `<img src="https://evil/x.png">` → dropped
- `<img src="data:image/png;base64,…">` → kept
- `<img src="/local/x.png">` → kept (same-origin/relative)

A new import test file (e.g. `src/tests/backend/specs/import.ts` — there is no existing import-flow file in `src/tests/backend/specs/`, only `ImportEtherpad.ts`) for native DOCX import:

- Fixture: a small known `.docx` with a heading, a paragraph, and a bullet list, committed under `src/tests/backend/specs/fixtures/`
- With `settings.soffice = null`, POST `/p/<pad>/import` with the fixture → assert pad atext/HTML contains the expected structure
- Negative: rename fixture to `.odt` extension, POST → still rejected with the "requires soffice" message

`exportHTMLSend` plugin hook: verify by reading the code whether the hook fires on the native paths (currently it's only invoked on the `type === 'html'` branch). If a small move is needed to keep the hook contract intact across native DOCX/PDF, include it. If the existing behavior is "hook only fires for html export", document that and don't change it — out of scope for this spec.

## Files touched

| File | Change |
|---|---|
| `src/node/handler/ExportHandler.ts` | Replace flag-gated branch with soffice-first cascade; call sanitizer; native PDF + DOCX dispatch |
| `src/node/handler/ImportHandler.ts` | Soffice-first cascade; native DOCX import dispatch |
| `src/node/utils/ExportPdfNative.ts` | **new** — pdfkit walker, ≤500 lines (bail-out criterion) |
| `src/node/utils/ExportSanitizeHtml.ts` | **new** — `stripRemoteImages`, ~50 lines |
| `src/node/utils/ImportDocxNative.ts` | **new** — mammoth wrapper, ~30 lines |
| `src/node/hooks/express/importexport.ts` | Tighten export and import route guards to `['odt','doc','pdf','rtf']`-as-appropriate |
| `src/node/utils/Settings.ts` | **revert** `nativeDocxExport` field (introduced by PR #7568) |
| `src/static/js/pad_impexp.ts` | Always show DOCX + PDF export links; ODT link still gated on `exportAvailable` |
| `src/package.json` | Add `pdfkit`, `htmlparser2`, `mammoth`. Keep `html-to-docx`. Drop nothing. |
| `pnpm-lock.yaml` | Lockfile regen |
| `settings.json.template`, `settings.json.docker` | **revert** `nativeDocxExport` entries |
| `doc/docker.md` | **revert** `NATIVE_DOCX_EXPORT` row |
| `src/tests/backend/specs/export.ts` | Revise DOCX tests (`soffice=null`); add PDF tests; add negative ODT; add unit test for sanitizer |
| `src/tests/backend/specs/import.ts` | Add native DOCX import tests; add negative ODT |
| `src/tests/backend/specs/fixtures/<file>.docx` | **new** — small DOCX fixture |

## Open questions handled in implementation, not spec

- Exact error response shape for the route-guard-rejected formats — match whatever the existing soffice-disabled path uses, no fresh design.
- Whether `exportHTMLSend` needs to fire on the native paths — covered in the test plan; verify against current behavior, don't expand scope.
- Image MIME sniffing for `data:` URLs in the PDF walker — `pdfkit` accepts PNG/JPEG buffers; we'll decode the base64 and let pdfkit reject unsupported types, surfacing as a converter error.

## Dependencies summary

| Package | Purpose | Approx install size |
|---|---|---|
| `html-to-docx` | DOCX export (pre-existing in PR #7568) | ~5 MB |
| `pdfkit` | PDF export rendering | ~2 MB |
| `htmlparser2` | HTML SAX parser used by walker + sanitizer | <1 MB |
| `mammoth` | DOCX → HTML import | ~3 MB |

Total added install: roughly 11 MB across all four. Compared against ~500 MB for LibreOffice and ~200 MB for puppeteer (the alternative considered and rejected in #7538), this is the right tradeoff for the structural-fidelity bar.

## Out of scope (deferred to follow-ups)

- Native ODT export — file follow-up issue.
- Native PDF/ODT/DOC/RTF import — file follow-up issue, document why they were rejected (no mature pure-JS readers).
- Memory/timeout caps on conversion — add when production signal warrants.
- Plugin hook coverage on native paths — beyond the `exportHTMLSend` check above.
