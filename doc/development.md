# Development

This page is a contributor-oriented tour of the Etherpad source tree and of a
few internals that plugin authors and core contributors commonly need to
understand: how the source is laid out, how pads are converted to and from
other formats, and how to access the database from server-side code.

The Etherpad server is written in TypeScript (`.ts`). Most server code lives
under `src/node/` and most client code under `src/static/js/`.

## Source tree overview

The repository root contains, among others, the following directories:

```
etherpad/
|- bin/        # maintenance and build scripts (run.sh, pad tools, docs, release)
|- doc/        # this manual, in AsciiDoc and Markdown
|- src/        # the Etherpad source code
|- packaging/  # OS/distribution packaging helpers
|- var/        # runtime data (e.g. the dirty.db database file)
```

`bin/` contains scripts for running and maintaining Etherpad. For example
`bin/run.sh` starts the server, and there are TypeScript utilities such as
`bin/checkPad.ts`, `bin/deletePad.ts`, `bin/repairPad.ts`,
`bin/rebuildPad.ts`, `bin/migrateDB.ts` and `bin/make_docs.ts`.

The HTML manual is built from the AsciiDoc sources in `doc/` by
`bin/make_docs.ts` (exposed as the `makeDocs` script), which shells out to
`asciidoctor` and writes the result to `out/doc/`. From the repository root you
can run it with `pnpm run makeDocs`. (`asciidoctor` must be installed.)

The `src/` directory looks like this:

```
src/
|- locales/      # translations, managed via https://translatewiki.net
|- node/         # server-side code
|- static/       # client-side code, CSS and fonts
|- templates/    # server-rendered page templates
|- ep.json       # core plugin/hook registration
|- package.json  # package name: ep_etherpad-lite
```

### src/node/ (server side)

```
src/node/
|- db/        # database access and pad/author/group/session state
|- eejs/      # server-side embedded-JS templating
|- handler/   # import/export and collaboration message handling
|- hooks/     # express route registration and i18n
|- security/  # crypto, OAuth2/OIDC, secret rotation
|- types/     # shared TypeScript types
|- updater/   # in-place self-update machinery
|- utils/     # settings, import/export format helpers, toolbar, minification
|- server.ts  # entry point
```

`db/` contains the modules that read and write pad state. `Pad.ts` manages an
individual pad; `PadManager.ts`, `AuthorManager.ts`, `GroupManager.ts`,
`SessionManager.ts` and `ReadOnlyManager.ts` manage the corresponding records;
`DB.ts` exposes the low-level key/value store (see
[Accessing the database from server code / plugins](#accessing-the-database-from-server-code-plugins)); and `API.ts` implements
the public HTTP API.

`handler/` contains the request and message handlers. `PadMessageHandler.ts`
drives real-time collaboration, while `ImportHandler.ts` and `ExportHandler.ts`
handle import and export.

`hooks/` contains mostly Express-related code. `i18n.ts` builds the translation
files and registers routes to serve them, and `hooks/express/` registers the
routes that serve pads, the timeslider, static assets and the admin pages.

`utils/` contains the import/export format converters (`ImportHtml.ts`,
`ExportHtml.ts`, `ExportTxt.ts`, `ExportEtherpad.ts`, `ImportEtherpad.ts`,
`ExportHelper.ts`, and native converters such as `ExportPdfNative.ts` and
`ImportDocxNative.ts`), the settings parser (`Settings.ts`), the toolbar builder
(`toolbar.ts`) and the asset minifier (`Minify.ts`).

### src/static/ (client side)

```
src/static/
|- css/    # stylesheets, including css/pad/icons.css
|- font/   # web fonts, including the fontawesome-etherpad icon font
|- img/
|- js/     # client-side TypeScript
|- skins/  # bundled UI skins
|- vendor/
```

`js/` contains the client-side editor code. Notable modules include
`ace2_inner.ts` and `ace2_common.ts` (the editor core), `contentcollector.ts`,
`linestylefilter.ts` and `domline.ts` (content/attribute processing, shared
with the server import/export pipeline), `Changeset.ts` and `AttributePool.ts`
(the changeset and attribute model), and `collab_client.ts` (the
client side of real-time collaboration).

### src/templates/

`templates/` contains the server-rendered page templates for the index, the
pad, the timeslider and the admin pages, plus the bootstrap scripts that load
the client bundles. The templates expose named `eejs` blocks that plugins can
hook into to inject custom HTML.

## How Etherpad converts pads to and from other formats

Internally a pad is not stored as HTML. A pad is a sequence of lines, and each
line carries **attributes** (for example `heading1`, `bullet` or a list number).
The set of attributes that a pad can use is stored in its **attribute pool**; the
pool only records which attributes exist, not where they are applied. The
pool grows over the history of the pad.

Where an attribute is applied to a line is recorded in an **attribute string**,
and a line that carries a line-level attribute is prefixed with a **line marker**
(`lmkr`). Attribute strings and changesets are defined by
`src/static/js/Changeset.ts` and `src/static/js/AttributePool.ts`.

### Collecting content

`src/static/js/contentcollector.ts` is the shared starting point for both the
client (when content is typed or pasted) and the server (when content is
imported). It walks the incoming DOM/HTML, decides which attributes apply to
each line, adds the discovered attributes to the attribute pool, and emits the
resulting attribute strings. On import, `src/node/utils/ImportHtml.ts` calls
`contentcollector.makeContentCollector(...)` to do exactly this, and the HTML
import path in `src/node/handler/ImportHandler.ts` ultimately drives it.

### From attributes to HTML/text (export)

On export the flow is, conceptually:

```
contentcollector.ts
  -> linestylefilter.ts
    -> ExportHtml.ts / ExportTxt.ts (helped by ExportHelper.ts)
      -> ExportHandler.ts
        -> the HTTP API / /export/* route
```

- `src/static/js/linestylefilter.ts` walks each line, reads its attributes,
  and turns them into the classes/markup the line should render with.
- `src/node/utils/ExportHelper.ts` adds export-only logic that does not belong
  in the live editor. The clearest example is lists: in the editor each list
  item is rendered as its own line-level block, but a clean export needs the
  items collapsed into a single properly nested list. The helper performs that
  reshaping for export only.
- `src/node/utils/ExportHtml.ts` and `src/node/utils/ExportTxt.ts` (and
  `ExportEtherpad.ts` for the native `.etherpad` format) turn the attributed
  text (`atext`) into the final HTML or plain text.
- `src/node/handler/ExportHandler.ts` receives the export request and dispatches
  on the requested format — for instance, office formats such as `.docx` and
  `.pdf` are routed through the native converters / LibreOffice rather than
  through the plain HTML/text path.

On the client side, edits are turned into changesets by the editor, attributes
are translated into CSS classes (so `heading2` becomes
`class="heading2"`), and `src/static/js/domline.ts` (`createDomLine`) renders
the final DOM for each line.

## Accessing the database from server code / plugins

Etherpad stores everything in a single key/value store backed by
[ueberDB](https://www.npmjs.com/package/ueberdb2), which abstracts over the
configured database (dirtyDB, MySQL/MariaDB, PostgreSQL, SQLite, MongoDB, Redis,
and others). Server-side code and plugins access it through
`src/node/db/DB.ts`.

The package name of the core module is, for historical reasons, still
`ep_etherpad-lite`, so plugins import the database module like this:

```javascript
const db = require('ep_etherpad-lite/node/db/DB');
```

The exposed methods are asynchronous and return promises (use `await`), not the
old callback style. The available methods are `get`, `set`, `remove`, `getSub`,
`setSub`, `findKeys` and `findKeysPaged`:

```javascript
// Read a record (returns undefined/null if it does not exist)
const value = await db.get('record_key');

// Create or replace a record
await db.set('record_key', data);

// Read or write a nested value inside a record
const colorId = await db.getSub('author_key', ['colorId']);
await db.setSub('author_key', ['email'], 'tutti@frutti.org');

// Delete a record
await db.remove('record_key');
```

For example, given the author record:

```json
{"colorId":"#79d9d9","name":"tutti","timestamp":1364832712430,"padIDs":{"mypad":1}}
```

calling `await db.setSub('author_key', ['email'], 'tutti@frutti.org')` yields:

```json
{"colorId":"#79d9d9","name":"tutti","timestamp":1364832712430,"padIDs":{"mypad":1},"email":"tutti@frutti.org"}
```

::: warning
Keys are namespaced (for example `pad:<padId>`,
`pad:<padId>:revs:<rev>`, `globalAuthor:<authorId>`). Prefer the high-level
managers (`Pad.ts`, `AuthorManager.ts`, etc.) over direct `DB` access where one
exists; reach for `DB` directly only for data your plugin owns, and use a key
prefix unique to your plugin to avoid collisions.
:::

## Adding a toolbar icon

Etherpad's toolbar icons come from the bundled `fontawesome-etherpad` icon
font in `src/static/font/`. Toolbar buttons reference an icon by a
`buttonicon-<name>` CSS class (see `src/node/utils/toolbar.ts`, which builds
each button's class as `buttonicon buttonicon-<name>`), and those classes are
defined in `src/static/css/pad/icons.css`. The font itself is generated with
[Fontello](http://fontello.com) from `src/static/font/config.json` (whose
`css_prefix_text` is `buttonicon-`).

To add a new icon:

1. Go to [Fontello](http://fontello.com) and import the existing
  `src/static/font/config.json` (Fontello's "import" loads the current icon
  set and pre-selects the icons it contains).
2. Select the additional icon(s) you want, then click **Download webfont**.
3. From the unzipped download, copy `config.json` and the
  `font/fontawesome-etherpad.*` files over the ones in `src/static/font/`.
4. From the unzipped `css/fontawesome-etherpad.css`, copy the new
  `.buttonicon-<name>:before { content: '\\eXXX'; }` rules into
  `src/static/css/pad/icons.css`, replacing the existing block of icon rules.

The icon is then available wherever a `buttonicon-<name>` class can be used,
including toolbar button definitions.
