# 2.6.1

For those wondering where the new updates are and why it was very quite throughout the last 1 1/2 years – I've been working on a new implementation of Etherpad from scratch in Go. It's called Etherpad-Go and you can find it here: `https://github.com/ether/etherpad-go`
and a short FAQ about it here: https://github.com/ether/etherpad-go/wiki/FAQ . I'd love to hear your feedback about it either on Discord or issue tracker. There is a README.md that explains how to get started and try it out and also the FAQ can be quite fruitful. Latest release can be found here: https://github.com/ether/etherpad-go/releases/tag/v0.0.4


### Notable enhancements and fixes of this release

- Minor fixes and improvements to the session transfer feature introduced in 2.6.0
- Dependencies upgrades


# 2.6.0

### Notable enhancements and fixes

- Added native option to transfer your Etherpad session between browsers. If you use multiple browsers or different PC for Etherpad they are different sessions. Meaning typing on one PC and then switching to another one in the same pad will result in different authorship colors. With this new feature you can now transfer your session to another browser or PC. To do so, open the home page and click on the wheel icon in the top right corner. After that click through the first dialog prompting you to copy a code to your clipboard. On your second browser open the same dialog and switch to "Receive Session" tab. There you can paste the code you copied before and click on "Receive Session". After that your session is transferred, and you can continue editing with the same authorship color as before. Just be aware that you can't have two active sessions at once in a pad.
- Updated to oidc provider v2.6.0 after resolving compatibility issues.

🎉 For all the people celebrating: Have a happy and awesome new year! 🎉 There is something big on the horizon for Etherpad in 2026. Stay tuned!

# 2.5.3

### Notable enhancements and fixes
- Fixed an issue with the release script that caused the release to not be created correctly.

# 2.5.2

### Notable enhancements and fixes

- Fixes the no skin theme having an overlapping
- Adds a new setting to disable recent pads to be shown. By setting `showRecentPads` to false in the `settings.json` file you can disable the recent pads feature on the home screen.
- Sets the oidc-provider version to 9.5.1 as 9.5.2 crashes Etherpad on startup.

# 2.5.1

### Notable enhancements and fixes

- Added endpoint for prometheus scraping. You can now scrape the metrics endpoint with prometheus. It is available at /stats/prometheus if you have enableMetrics set to true in your settings.json

- fixed exposeVersion causing the pad panel to not load correctly
- fixed admin manage pad url to also take the base path into account

# 2.5.0

### Notable enhancements and fixes

- Updated to express 5.0.0. This is a major update to express that brings a lot of improvements and fixes. Please update all your plugins to the latest version to ensure compatibility. A lot changed in the route matching, and thus old plugins will throw errors and crash Etherpad.
- Fixed an issue with the no-skin theme with cookie recentPadList feature
- Fixed layout issues with the no-skin theme

# 2.4.2

### Notable enhancements and fixes
- Fixed a german translation in the english translation file.

# 2.4.1

### Notable enhancements and fixes

- Added generating release through ci cd pipeline.
- Readded temporarily disabled workflows after release generation works again

# 2.4.0

### Notable enhancements and fixes
- Added home button to the pad panel. To show it in your current instance, please copy the updated "toolbar" settings from the `settings.json.template` file to your `settings.json` file.
- Added more current design for the default collibri theme.
- Added handling of recent visited pads in the collibri theme. You can now access the most recent three pads you visited in the pad panel.
- Disable stats endpoints if enableMetrics is set to false. This allows you to disable the metrics endpoints if you don't want to use them.
- Use Node LTS instead of always latest Node version.


# 2.3.2

### Notable enhancements and fixes

- Fixed admin ui displaying incorrect text

# 2.3.1

### Notable enhancements and fixes

- Dependency updates

# 2.3.0

### Notable enhancements and fixes

- Added possibility to cluster Etherpads behind reverse proxy. There is now a new reverse proxy designed for Etherpads that handles multiple Etherpads and the created pads in them. It will assign the pad assignement to an Etherpad at random but once the choice was made it will always reverse proxy the same backend. This allows to host multiple concurrent Etherpads and benefit from multi core systems even though one Etherpad is singlethreaded.
- Added reverse proxy configuration for replacing Nginx. In the past there were some issues with nginx and its configuration. This reverse proxy allows you to handle your configuration with ease.

If you want to find out more about the reverse proxy method check out the repository https://github.com/ether/etherpad-proxy . It also contains a sample docker-compose file with three Etherpads and one etherpad-proxy. Of course you need to adapt the settings.json.template to your liking and map it into the reverse proxy image before you are ready :).


- Added client authorization to work with Etherpad. Before it would get blocked because it doesn't have the required claim. As this is now fixed etherpad-proxy can also work with your new OAuth2 configuration and retrieve a token via client credentials flow.




# 2.2.7


### Notable enhancements and fixes

- We migrated all important pages to React 19 and React Router v7

Besides that only dependency updates.


 -> Have a merry Christmas and a happy new year.  🎄 🎁


# 2.2.6

### Notable enhancements and fixes

- Added option to delete a pad by the creator. This option can be found in the settings menu. When you click on it you get a confirm dialog and after that you have the chance to completely erase the pad.


# 2.2.5

### Notable enhancements and fixes

- Fixed timeslider not scrolling when the revision count is a multiple of 100
- Added new Restful API for version 2 of Etherpad. It is available at /api-docs


# 2.2.4

### Notable enhancements and fixes

- Switched to new SQLite backend
- Fixed rusty-store-kv module not found


# 2.2.3

### Notable enhancements and fixes

- Introduced a new in process database `rustydb` that represents a fast key value store written in Rust.
- Readded window._ as a shortcut for getting text
- Added support for migrating any ueberdb database to another. You can now switch as you please. See here: https://docs.etherpad.org/cli.html
- Further Typescript movements
- A lot of security issues fixed and reviewed in this release. Please update.


# 2.2.2

### Notable enhancements and fixes

- Removal of Etherpad require kernel: We finally managed to include esbuild to bundle our frontend code together. So no matter how many plugins your server has it is always one JavaScript file. This boosts performance dramatically.
- Added log layoutType: This lets you print the log in either colored or basic (black and white text)
- Introduced esbuild for bundling CSS files
- Cache all files to be bundled in memory for faster load speed


# 2.1.1


### Notable enhancements and fixes

- Fixed failing Docker build when checked out as git submodule. Thanks to @neurolabs
- Fixed: Fallback to websocket and polling when unknown(old) config is present for socket io
- Fixed: Next page disabled if zero page by @samyakj023
- On CTRL+CLICK bring the window back to focus by Helder Sepulveda

# 2.1.0

### Notable enhancements and fixes

- Added PWA support. You can now add your Etherpad instance to your home screen on your mobile device or desktop.
- Fixed live plugin manager versions clashing. Thanks to @yacchin1205
- Fixed a bug in the pad panel where pagination was not working correctly when sorting by pad name

### Compatibility changes

- Reintroduced APIKey.txt support. You can now switch between APIKey and OAuth2.0 authentication. This can be toggled with the setting authenticationMethod. The default is OAuth2. If you want to use the APIKey method you can set that to `apikey`.


# 2.0.3

### Notable enhancements and fixes

- Added documentation for replacing apikeys with oauth2
- Bumped live plugin manager to 0.20.0. Thanks to @fgreinacher
- Added better documentation for using docker-compose with Etherpad



# 2.0.2

### Notable enhancements and fixes

- Fixed the locale loading in the admin panel
- Added OAuth2.0 support for the Etherpad API. You can now log in  into the Etherpad API with your admin user using OAuth2

### Compatibility changes

- The tests now require generating a token from the OAuth secret. You can find the `generateJWTToken` in the common.ts script for plugin endpoint updates.


# 2.0.1

### Notable enhancements and fixes

- Fixed a bug where a plugin depending on a scoped dependency would not install successfully.


# 2.0.0


### Compatibility changes

- Socket io has been updated to 4.7.5. This means that the json.send function won't work anymore and needs to be changed to .emit('message', myObj)
- Deprecating npm version 6 in favor of pnpm: We have made the decision to switch to the well established pnpm (https://pnpm.io/). It works by symlinking dependencies into a global directory allowing you to have a cleaner and more reliable environment.
- Introducing Typescript to the Etherpad core: Etherpad core logic has been rewritten in Typescript allowing for compiler checking of errors.
- Rewritten Admin Panel: The Admin panel has been rewritten in React and now features a more pleasant user experience. It now also features an integrated pad searching with sorting functionality.

### Notable enhancements and fixes

* Bugfixes
  - Live Plugin Manager: The live plugin manager caused problems when a plugin had depdendencies defined. This issue is now resolved.

* Enhancements
  - pnpm Workspaces: In addition to pnpm we introduced workspaces. A clean way to manage multiple bounded contexts like the admin panel or the bin folder.
  - Bin folder: The bin folder has been moved from the src folder to the root folder. This change was necessary as the contained scripts do not represent core functionality of the user.
  - Starting Etherpad: Etherpad can now be started with a single command: `pnpm run prod` in the root directory.
  - Installing Etherpad: Etherpad no longer symlinks itself in the root directory. This is now also taken care by pnpm, and it just creates a node_modules folder with the src directory`s ep_etherpad-lite folder
  - Plugins can now be installed simply via the command: `pnpm run plugins i first-plugin second-plugin` or if you want to install from path you can do:
  `pnpm run plugins i --path ../path-to-plugin`


# 1.9.7

### Notable enhancements and fixes

* Added Live Plugin Manager: Plugins are now installed into a separate folder on the host system. This folder is called `plugin_packages`.
That way the plugins are separated from the normal etherpad installation.
* Make repairPad.js more verbose
* Fixed favicon not being loaded correctly

# 1.9.6

### Notable enhancements and fixes

* Prevent etherpad crash when update server is not reachable
* Use npm@6 in Docker build
* Fix setting the log level in settings.json


# 1.9.5

### Compatibility changes

* This version deprecates NodeJS16 as it reached its end of life and won't receive any updates. So to get started with Etherpad v1.9.5 you need NodeJS 18 and above.
* The bundled windows NodeJS version has been bumped to the current LTS version 20.

### Notable enhancements and fixes

* The support for the tidy program to tidy up HTML files has been removed. This decision was made because it hasn't been updated for years and also caused an incompability when exporting a pad with Abiword.


# 1.9.4

### Compatibility changes

* Log4js has been updated to the latest version. As it involved a bump of 6 major version.
  A lot has changed since then. Most notably the console appender has been deprecated. You can find out more about it [here](https://github.com/log4js-node/log4js-node)

### Notable enhancements and fixes

* Fix for MySQL: The logger calls were incorrectly configured leading to a crash when e.g. somebody uses a different encoding than standard MySQL encoding.

# 1.9.3

### Compability changes

* express-rate-limit has been bumped to 7.0.0: This involves the breaking change that "max: 0"
in the importExportRateLimiting is set to always trigger. So set it to your desired value.
If you haven't changed that value in the settings.json you are all set.

### Notable enhancements and fixes

* Bugfixes
  * Fix etherpad crashing with mongodb database

* Enhancements
  * Add surrealdb database support. You can find out more about this database [here](https://surrealdb.com).
  * Make sqlite faster: The sqlite library has been switched to better-sqlite3. This should lead to better performance.

# 1.9.2

### Notable enhancements and fixes

* Security
  * Enable session key rotation: This setting can be enabled in the settings.json. It changes the signing key for the cookie authentication in a fixed interval.

* Bugfixes
  * Fix appendRevision when creating a new pad via the API without a text.


* Enhancements
  * Bump JQuery to version 3.7
  * Update elasticsearch connector to version 8

### Compatibility changes

* No compability changes as JQuery maintains excellent backwards compatibility.

#### For plugin authors

* Please update to JQuery 3.7. There is an excellent deprecation guide over [here](https://api.jquery.com/category/deprecated/). Version 3.1 to 3.7 are relevant for the upgrade.

# 1.9.1

### Notable enhancements and fixes

* Security
  * Limit requested revisions in timeslider and export to head revision. (affects v1.9.0)

* Bugfixes
  * revisions in `CHANGESET_REQ` (timeslider) and export (txt, html, custom)
    are now checked to be numbers.
  * bump sql for audit fix
* Enhancements
  * Add keybinding meta-backspace to delete to beginning of line
  * Fix automatic Windows build via GitHub Actions
  * Enable docs to be build cross platform thanks to asciidoctor

### Compatibility changes
* tests: drop windows 7 test coverage & use chrome latest for admin tests
* Require Node 16 for Etherpad and target Node 20 for testing


# 1.9.0

### Notable enhancements and fixes

* Windows build:
  * The bundled `node.exe` was upgraded from v12 to v16.
  * The bundled `node.exe` is now a 64-bit executable. If you need the 32-bit
    version you must download and install Node.js yourself.
* Improvements to login session management:
  * `express_sid` cookies and `sessionstorage:*` database records are no longer
    created unless `requireAuthentication` is `true` (or a plugin causes them to
    be created).
  * Login sessions now have a finite lifetime by default (10 days after
    leaving).
  * `sessionstorage:*` database records are automatically deleted when the login
    session expires (with some exceptions that will be fixed in the future).
  * Requests for static content (e.g., `/robots.txt`) and special pages (e.g.,
    the HTTP API, `/stats`) no longer create login session state.
  * The secret used to sign the `express_sid` cookie is now automatically
    regenerated every day (called *key rotation*) by default. If key rotation is
    enabled, the now-deprecated `SESSIONKEY.txt` file can be safely deleted
    after Etherpad starts up (its content is read and saved to the database and
    used to validate signatures from old cookies until they expire).
* The following settings from `settings.json` are now applied as expected (they
  were unintentionally ignored before):
  * `padOptions.lang`
  * `padOptions.showChat`
  * `padOptions.userColor`
  * `padOptions.userName`
* HTTP API:
  * Fixed the return value of `getText` when called with a specific revision.
  * Fixed a potential attribute pool corruption bug with
    `copyPadWithoutHistory`.
  * Mappings created by `createGroupIfNotExistsFor` are now removed from the
    database when the group is deleted.
  * Fixed race conditions in the `setText`, `appendText`, and `restoreRevision`
    functions.
  * Added an optional `authorId` parameter to `appendText`,
    `copyPadWithoutHistory`, `createGroupPad`, `createPad`, `restoreRevision`,
    `setHTML`, and `setText`, and bumped the latest API version to 1.3.0.
* Fixed a crash if the database is busy enough to cause a query timeout.
* New `/health` endpoint for getting information about Etherpad's health (see
  [draft-inadarei-api-health-check-06](https://www.ietf.org/archive/id/draft-inadarei-api-health-check-06.html)).
* Docker now uses the new `/health` endpoint for health checks, which avoids
  issues when authentication is enabled. It also avoids the unnecessary creation
  of database records for managing browser sessions.
* When copying a pad, the pad's records are copied in batches to avoid database
  timeouts with large pads.
* Exporting a large pad to `.etherpad` format should be faster thanks to bulk
  database record fetches.
* When importing an `.etherpad` file, records are now saved to the database in
  batches to avoid database timeouts with large pads.

#### For plugin authors

* New `expressPreSession` server-side hook.
* Pad server-side hook changes:
  * `padCheck`: New hook.
  * `padCopy`: New `srcPad` and `dstPad` context properties.
  * `padDefaultContent`: New hook.
  * `padRemove`: New `pad` context property.
* The `db` property on Pad objects is now public.
* New `getAuthorId` server-side hook.
* New APIs for processing attributes: `ep_etherpad-lite/static/js/attributes`
  (low-level API) and `ep_etherpad-lite/static/js/AttributeMap` (high-level
  API).
* The `import` server-side hook has a new `ImportError` context property.
* New `exportEtherpad` and `importEtherpad` server-side hooks.
* The `handleMessageSecurity` and `handleMessage` server-side hooks have a new
  `sessionInfo` context property that includes the user's author ID, the pad ID,
  and whether the user only has read-only access.
* The `handleMessageSecurity` server-side hook can now be used to grant write
  access for the current message only.
* The `init_<pluginName>` server-side hooks have a new `logger` context
  property that plugins can use to log messages.
* Prevent infinite loop when exiting the server
* Bump dependencies


### Compatibility changes

* Node.js v14.15.0 or later is now required.
* The default login session expiration (applicable if `requireAuthentication` is
  `true`) changed from never to 10 days after the user leaves.

#### For plugin authors

* The `client` context property for the `handleMessageSecurity` and
  `handleMessage` server-side hooks is deprecated; use the `socket` context
  property instead.
* Pad server-side hook changes:
  * `padCopy`:
    * The `originalPad` context property is deprecated; use `srcPad` instead.
    * The `destinationID` context property is deprecated; use `dstPad.id`
      instead.
  * `padCreate`: The `author` context property is deprecated; use the new
    `authorId` context property instead. Also, the hook now runs asynchronously.
  * `padLoad`: Now runs when a temporary Pad object is created during import.
    Also, it now runs asynchronously.
  * `padRemove`: The `padID` context property is deprecated; use `pad.id`
    instead.
  * `padUpdate`: The `author` context property is deprecated; use the new
    `authorId` context property instead. Also, the hook now runs asynchronously.
* Returning `true` from a `handleMessageSecurity` hook function is deprecated;
  return `'permitOnce'` instead.
* Changes to the `src/static/js/Changeset.js` library:
  * The following attribute processing functions are deprecated (use the new
    attribute APIs instead):
    * `attribsAttributeValue()`
    * `eachAttribNumber()`
    * `makeAttribsString()`
    * `opAttributeValue()`
  * `opIterator()`: Deprecated in favor of the new `deserializeOps()` generator
    function.
  * `appendATextToAssembler()`: Deprecated in favor of the new `opsFromAText()`
    generator function.
  * `newOp()`: Deprecated in favor of the new `Op` class.
* The `AuthorManager.getAuthor4Token()` function is deprecated; use the new
  `AuthorManager.getAuthorId()` function instead.
* The exported database records covered by the `exportEtherpadAdditionalContent`
  server-side hook now include keys like `${customPrefix}:${padId}:*`, not just
  `${customPrefix}:${padId}`.
* Plugin locales should overwrite core's locales Stale
* Plugin locales overwrite core locales

# 1.8.18

Released: 2022-05-05

### Notable enhancements and fixes

  * Upgraded ueberDB to fix a regression with CouchDB.

# 1.8.17

Released: 2022-02-23

### Security fixes

* Fixed a vunlerability in the `CHANGESET_REQ` message handler that allowed a
  user with any access to read any pad if the pad ID is known.

### Notable enhancements and fixes

* Fixed a bug that caused all pad edit messages received at the server to go
  through a single queue. Now there is a separate queue per pad as intended,
  which should reduce message processing latency when many pads are active at
  the same time.

# 1.8.16

### Security fixes

If you cannot upgrade to v1.8.16 for some reason, you are encouraged to try
cherry-picking the fixes to the version you are running:

```shell
git cherry-pick b7065eb9a0ec..77bcb507b30e
```

* Maliciously crafted `.etherpad` files can no longer overwrite arbitrary
  non-pad database records when imported.
* Imported `.etherpad` files are now subject to numerous consistency checks
  before any records are written to the database. This should help avoid
  denial-of-service attacks via imports of malformed `.etherpad` files.

### Notable enhancements and fixes

* Fixed several `.etherpad` import bugs.
* Improved support for large `.etherpad` imports.

# 1.8.15

### Security fixes

* Fixed leak of the writable pad ID when exporting from the pad's read-only ID.
  This only matters if you treat the writeable pad IDs as secret (e.g., you are
  not using [ep_padlist2](https://www.npmjs.com/package/ep_padlist2)) and you
  share the pad's read-only ID with untrusted users. Instead of treating
  writeable pad IDs as secret, you are encouraged to take advantage of
  Etherpad's authentication and authorization mechanisms (e.g., use
  [ep_openid_connect](https://www.npmjs.com/package/ep_openid_connect) with
  [ep_readonly_guest](https://www.npmjs.com/package/ep_readonly_guest), or write
  your own
  [authentication](https://etherpad.org/doc/v1.8.14/#index_authenticate) and
  [authorization](https://etherpad.org/doc/v1.8.14/#index_authorize) plugins).
* Updated dependencies.

### Compatibility changes

* The `logconfig` setting is deprecated.

#### For plugin authors

* Etherpad now uses [jsdom](https://github.com/jsdom/jsdom) instead of
  [cheerio](https://cheerio.js.org/) for processing HTML imports. There are two
  consequences of this change:
  * `require('ep_etherpad-lite/node_modules/cheerio')` no longer works. To fix,
    your plugin should directly depend on `cheerio` and do `require('cheerio')`.
  * The `collectContentImage` hook's `node` context property is now an
    [`HTMLImageElement`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLImageElement)
    object rather than a Cheerio Node-like object, so the API is slightly
    different. See
    [citizenos/ep_image_upload#49](https://github.com/citizenos/ep_image_upload/pull/49)
    for an example fix.
* The `clientReady` server-side hook is deprecated; use the new `userJoin` hook
  instead.
* The `init_<pluginName>` server-side hooks are now run every time Etherpad
  starts up, not just the first time after the named plugin is installed.
* The `userLeave` server-side hook's context properties have changed:
  * `auth`: Deprecated.
  * `author`: Deprecated; use the new `authorId` property instead.
  * `readonly`: Deprecated; use the new `readOnly` property instead.
  * `rev`: Deprecated.
* Changes to the `src/static/js/Changeset.js` library:
  * `opIterator()`: The unused start index parameter has been removed, as has
    the unused `lastIndex()` method on the returned object.
  * `smartOpAssembler()`: The returned object's `appendOpWithText()` method is
    deprecated without a replacement available to plugins (if you need one, let
    us know and we can make the private `opsFromText()` function public).
  * Several functions that should have never been public are no longer exported:
    `applyZip()`, `assert()`, `clearOp()`, `cloneOp()`, `copyOp()`, `error()`,
    `followAttributes()`, `opString()`, `stringOp()`, `textLinesMutator()`,
    `toBaseTen()`, `toSplices()`.

### Notable enhancements and fixes

* Accessibility fix for JAWS screen readers.
* Fixed "clear authorship" error (see issue #5128).
* Etherpad now considers square brackets to be valid URL characters.
* The server no longer crashes if an exception is thrown while processing a
  message from a client.
* The `useMonospaceFontGlobal` setting now works (thanks @Lastpixl!).
* Chat improvements:
  * The message input field is now a text area, allowing multi-line messages
    (use shift-enter to insert a newline).
  * Whitespace in chat messages is now preserved.
* Docker improvements:
  * New `HEALTHCHECK` instruction (thanks @Gared!).
  * New `settings.json` variables: `DB_COLLECTION`, `DB_URL`,
    `SOCKETIO_MAX_HTTP_BUFFER_SIZE`, `DUMP_ON_UNCLEAN_EXIT` (thanks
    @JustAnotherArchivist!).
  * `.ep_initialized` files are no longer created.
* Worked around a [Firefox Content Security Policy
  bug](https://bugzilla.mozilla.org/show_bug.cgi?id=1721296) that caused CSP
  failures when `'self'` was in the CSP header. See issue #4975 for details.
* UeberDB upgraded from v1.4.10 to v1.4.18. For details, see the [ueberDB
  changelog](https://github.com/ether/ueberDB/blob/master/CHANGELOG.md).
  Highlights:
  * The `postgrespool` driver was renamed to `postgres`, replacing the old
    driver of that name. If you used the old `postgres` driver, you may see an
    increase in the number of database connections.
  * For `postgres`, you can now set the `dbSettings` value in `settings.json` to
    a connection string (e.g., `"postgres://user:password@host/dbname"`) instead
    of an object.
  * For `mongodb`, the `dbName` setting was renamed to `database` (but `dbName`
    still works for backwards compatibility) and is now optional (if unset, the
    database name in `url` is used).
* `/admin/settings` now honors the `--settings` command-line argument.
* Fixed "Author *X* tried to submit changes as author *Y*" detection.
* Error message display improvements.
* Simplified pad reload after importing an `.etherpad` file.

#### For plugin authors

* `clientVars` was added to the context for the `postAceInit` client-side hook.
  Plugins should use this instead of the `clientVars` global variable.
* New `userJoin` server-side hook.
* The `userLeave` server-side hook has a new `socket` context property.
* The `helper.aNewPad()` function (accessible to client-side tests) now
  accepts hook functions to inject when opening a pad. This can be used to
  test any new client-side hooks your plugin provides.
* Chat improvements:
  * The `chatNewMessage` client-side hook context has new properties:
    * `message`: Provides access to the raw message object so that plugins can
      see the original unprocessed message text and any added metadata.
    * `rendered`: Allows plugins to completely override how the message is
      rendered in the UI.
  * New `chatSendMessage` client-side hook that enables plugins to process the
    text before sending it to the server or augment the message object with
    custom metadata.
  * New `chatNewMessage` server-side hook to process new chat messages before
    they are saved to the database and relayed to users.
* Readability improvements to browser-side error stack traces.
* Added support for socket.io message acknowledgments.

# 1.8.14

### Security fixes

* Fixed a persistent XSS vulnerability in the Chat component. In case you can't
  update to 1.8.14 directly, we strongly recommend to cherry-pick
  a7968115581e20ef47a533e030f59f830486bdfa. Thanks to sonarsource for the
  professional disclosure.

### Compatibility changes

* Node.js v12.13.0 or later is now required.
* The `favicon` setting is now interpreted as a pathname to a favicon file, not
  a URL. Please see the documentation comment in `settings.json.template`.
* The undocumented `faviconPad` and `faviconTimeslider` settings have been
  removed.
* MySQL/MariaDB now uses connection pooling, which means you will see up to 10
  connections to the MySQL/MariaDB server (by default) instead of 1. This might
  cause Etherpad to crash with a "ER_CON_COUNT_ERROR: Too many connections"
  error if your server is configured with a low connection limit.
* Changes to environment variable substitution in `settings.json` (see the
  documentation comments in `settings.json.template` for details):
  * An environment variable set to the string "null" now becomes `null` instead
    of the string "null". Similarly, if the environment variable is unset and
    the default value is "null" (e.g., `"${UNSET_VAR:null}"`), the value now
    becomes `null` instead of the string "null". It is no longer possible to
    produce the string "null" via environment variable substitution.
  * An environment variable set to the string "undefined" now causes the setting
    to be removed instead of set to the string "undefined". Similarly, if the
    environment variable is unset and the default value is "undefined" (e.g.,
    `"${UNSET_VAR:undefined}"`), the setting is now removed instead of set to
    the string "undefined". It is no longer possible to produce the string
    "undefined" via environment variable substitution.
  * Support for unset variables without a default value is now deprecated.
    Please change all instances of `"${FOO}"` in your `settings.json` to
    `${FOO:null}` to keep the current behavior.
  * The `DB_*` variable substitutions in `settings.json.docker` that previously
    defaulted to `null` now default to "undefined".
* Calling `next` without argument when using `Changeset.opIterator` does always
  return a new Op. See b9753dcc7156d8471a5aa5b6c9b85af47f630aa8 for details.

### Notable enhancements and fixes

* MySQL/MariaDB now uses connection pooling, which should improve stability and
  reduce latency.
* Bulk database writes are now retried individually on write failure.
* Minify: Avoid crash due to unhandled Promise rejection if stat fails.
* padIds are now included in /socket.io query string, e.g.
  `https://video.etherpad.com/socket.io/?padId=AWESOME&EIO=3&transport=websocket&t=...&sid=...`.
  This is useful for directing pads to separate socket.io nodes.
* <script> elements added via aceInitInnerdocbodyHead hook are now executed.
* Fix read only pad access with authentication.
* Await more db writes.
* Disabled wtfnode dump by default.
* Send `USER_NEWINFO` messages on reconnect.
* Fixed loading in a hidden iframe.
* Fixed a race condition with composition. (Thanks @ingoncalves for an
  exceptionally detailed analysis and @rhansen for the fix.)

# 1.8.13

### Notable fixes

* Fixed a bug in the safeRun.sh script (#4935)
* Add more endpoints that do not need authentication/authorization (#4921)
* Fixed issue with non-opening device keyboard on smartphones (#4929)
* Add version string to iframe_editor.css to prevent stale cache entry (#4964)

### Notable enhancements

* Refactor pad loading (no document.write anymore) (#4960)
* Improve import/export functionality, logging and tests (#4957)
* Refactor CSS manager creation (#4963)
* Better metrics
* Add test for client height (#4965)

### Dependencies

* ueberDB2 1.3.2 -> 1.4.4
* express-rate-limit 5.2.5 -> 5.2.6
* etherpad-require-kernel 1.0.9 -> 1.0.11

# 1.8.12

Special mention: Thanks to Sauce Labs for additional testing tunnels to help us
grow! :)

### Security patches

* Fixed a regression in v1.8.11 which caused some pad names to cause Etherpad to
  restart.

### Notable fixes

* Fixed a bug in the `dirty` database driver that sometimes caused Node.js to
  crash during shutdown and lose buffered database writes.
* Fixed a regression in v1.8.8 that caused "Uncaught TypeError: Cannot read
  property '0' of undefined" with some plugins (#4885)
* Less warnings in server console for supported element types on import.
* Support Azure and other network share installations by using a more truthful
  relative path.

### Notable enhancements

* Dependency updates
* Various Docker deployment improvements
* Various new translations
* Improvement of rendering of plugin hook list and error message handling

# 1.8.11

### Notable fixes

* Fix server crash issue within PadMessageHandler due to SocketIO handling
* Fix editor issue with drop downs not being visible
* Ensure correct version is passed when loading front end resources
* Ensure underscore and jquery are available in original location for plugin comptability

### Notable enhancements

* Improved page load speeds

# 1.8.10

### Security Patches

* Resolve potential ReDoS vulnerability in your project - GHSL-2020-359

### Compatibility changes

* JSONP API has been removed in favor of using the mature OpenAPI implementation.
* Node 14 is now required for Docker Deployments

### Notable fixes

* Various performance and stability fixes

### Notable enhancements

* Improved line number alignment and user experience around line anchors
* Notification to admin console if a plugin is missing during user file import
* Beautiful loading and reconnecting animation
* Additional code quality improvements
* Dependency updates

# 1.8.9

### Notable fixes

* Fixed HTTP 400 error when importing via the UI.
* Fixed "Error: spawn npm ENOENT" crash on startup in Windows.

### Notable enhancements

* Removed some unnecessary arrow key handling logic.
* Dependency updates.

# 1.8.8

### Security patches

* EJS has been updated to 3.1.6 to mitigate an Arbitrary Code Injection

### Compatibility changes

* Node.js 10.17.0 or newer is now required.
* The `bin/` and `tests/` directories were moved under `src/`. Symlinks were
  added at the old locations to hopefully avoid breaking user scripts and other
  tools.
* Dependencies are now installed with the `--no-optional` flag to speed
  installation. Optional dependencies such as `sqlite3` must now be manually
  installed (e.g., `(cd src && npm i sqlite3)`).
* Socket.IO messages are now limited to 10K bytes to make denial of service
  attacks more difficult. This may cause issues when pasting large amounts of
  text or with plugins that send large messages (e.g., `ep_image_upload`). You
  can change the limit via `settings.json`; see `socketIo.maxHttpBufferSize`.
* The top-level `package.json` file, added in v1.8.7, has been removed due to
  problematic npm behavior. Whenever you install a plugin you will see the
  following benign warnings that can be safely ignored:

  ```
  npm WARN saveError ENOENT: no such file or directory, open '.../package.json'
  npm WARN enoent ENOENT: no such file or directory, open '.../package.json'
  npm WARN develop No description
  npm WARN develop No repository field.
  npm WARN develop No README data
  npm WARN develop No license field.
  ```

### Notable enhancements

* You can now generate a link to a specific line number in a pad. Appending
  `#L10` to a pad URL will cause your browser to scroll down to line 10.
* Database performance is significantly improved.
* Admin UI now has test coverage in CI. (The tests are not enabled by default;
  see `settings.json`.)
* New stats/metrics: `activePads`, `httpStartTime`, `lastDisconnected`,
  `memoryUsageHeap`.
* Improved import UX.
* Browser caching improvements.
* Users can now pick absolute white (`#fff`) as their color.
* The `settings.json` template used for Docker images has new variables for
  controlling rate limiting.
* Admin UI now has test coverage in CI. (The tests are not enabled by default
  because the admin password is required; see `settings.json`.)
* For plugin authors:
  * New `callAllSerial()` function that invokes hook functions like `callAll()`
    except it supports asynchronous hook functions.
  * `callFirst()` and `aCallFirst()` now support the same wide range of hook
    function behaviors that `callAll()`, `aCallAll()`, and `callAllSerial()`
    support. Also, they now warn when a hook function misbehaves.
  * The following server-side hooks now support asynchronous hook functions:
    `expressConfigure`, `expressCreateServer`, `padCopy`, `padRemove`
  * Backend tests for plugins can now use the
    [`ep_etherpad-lite/tests/backend/common`](src/tests/backend/common.js)
    module to start the server and simplify API access.
  * The `checkPlugins.js` script now automatically adds GitHub CI test coverage
    badges for backend tests and npm publish.

### Notable fixes

* Enter key now stays in focus when inserted at bottom of viewport.
* Numbering for ordered list items now properly increments when exported to
  text.
* Suppressed benign socket.io connection errors
* Interface no longer loses color variants on disconnect/reconnect event.
* General code quality is further significantly improved.
* Restarting Etherpad via `/admin` actions is more robust.
* Improved reliability of server shutdown and restart.
* No longer error if no buttons are visible.
* For plugin authors:
  * Fixed `collectContentLineText` return value handling.

# 1.8.7
### Compatibility-breaking changes
* **IMPORTANT:** It is no longer possible to protect a group pad with a
  password. All API calls to `setPassword` or `isPasswordProtected` will fail.
  Existing group pads that were previously password protected will no longer be
  password protected. If you need fine-grained access control, you can restrict
  API session creation in your frontend service, or you can use plugins.
* All workarounds for Microsoft Internet Explorer have been removed. IE might
  still work, but it is untested.
* Plugin hook functions are now subject to new sanity checks. Buggy hook
  functions will cause an error message to be logged
* Authorization failures now return 403 by default instead of 401
* The `authorize` hook is now only called after successful authentication. Use
  the new `preAuthorize` hook if you need to bypass authentication
* The `authFailure` hook is deprecated; use the new `authnFailure` and
  `authzFailure` hooks instead
* The `indexCustomInlineScripts` hook was removed
* The `client` context property for the `handleMessage` and
  `handleMessageSecurity` hooks has been renamed to `socket` (the old name is
  still usable but deprecated)
* The `aceAttribClasses` hook functions are now called synchronously
* The format of `ENTER`, `CREATE`, and `LEAVE` log messages has changed
* Strings passed to `$.gritter.add()` are now expected to be plain text, not
  HTML. Use jQuery or DOM objects if you need formatting

### Notable new features
* Users can now import without creating and editing the pad first
* Added a new `readOnly` user setting that makes it possible to create users in
  `settings.json` that can read pads but not create or modify them
* Added a new `canCreate` user setting that makes it possible to create users in
  `settings.json` that can modify pads but not create them
* The `authorize` hook now accepts `readOnly` to grant read-only access to a pad
* The `authorize` hook now accepts `modify` to grant modify-only (creation
  prohibited) access to a pad
* All authentication successes and failures are now logged
* Added a new `cookie.sameSite` setting that makes it possible to enable
  authentication when Etherpad is embedded in an iframe from another site
* New `exportHTMLAdditionalContent` hook to include additional HTML content
* New `exportEtherpadAdditionalContent` hook to include additional database
  content in `.etherpad` exports
* New `expressCloseServer` hook to close Express when required
* The `padUpdate` hook context now includes `revs` and `changeset`
* `checkPlugin.js` has various improvements to help plugin developers
* The HTTP request object (and therefore the express-session state) is now
  accessible from within most `eejsBlock_*` hooks
* Users without a `password` or `hash` property in `settings.json` are no longer
  ignored, so they can now be used by authentication plugins
* New permission denied modal and block ``permissionDenied``
* Plugins are now updated to the latest version instead of minor or patches

### Notable fixes
* Fixed rate limit accounting when Etherpad is behind a reverse proxy
* Fixed typos that prevented access to pads via an HTTP API session
* Fixed authorization failures for pad URLs containing a percent-encoded
  character
* Fixed exporting of read-only pads
* Passwords are no longer written to connection state database entries or logged
  in debug logs
* When using the keyboard to navigate through the toolbar buttons the button
  with the focus is now highlighted
* Fixed support for Node.js 10 by passing the `--experimental-worker` flag
* Fixed export of HTML attributes within a line
* Fixed occasional "Cannot read property 'offsetTop' of undefined" error in
  timeslider when "follow pad contents" is checked
* socket.io errors are now displayed instead of silently ignored
* Pasting while the caret is in a link now works (except for middle-click paste
  on X11 systems)
* Removal of Microsoft Internet Explorer specific code
* Import better handles line breaks and white space
* Fix issue with ``createDiffHTML`` incorrect call of ``getInternalRevisionAText``
* Allow additional characters in URLs
* MySQL engine fix and various other UeberDB updates (See UeberDB changelog).
* Admin UI improvements on search results (to remove duplicate items)
* Removal of unused cruft from ``clientVars`` (``ip`` and ``userAgent``)


### Minor changes
* Temporary disconnections no longer force a full page refresh
* Toolbar layout for narrow screens is improved
* Fixed `SameSite` cookie attribute for the `language`, `token`, and `pref`
  cookies
* Fixed superfluous database accesses when deleting a pad
* Expanded test coverage.
* `package-lock.json` is now lint checked on commit
* Various lint fixes/modernization of code

# 1.8.6
* IMPORTANT: This fixes a severe problem with postgresql in 1.8.5
* SECURITY: Fix authentication and authorization bypass vulnerabilities
* API: Update version to 1.2.15
* FEATURE: Add copyPadWithoutHistory API (#4295)
* FEATURE: Package more asset files to save http requests (#4286)
* MINOR: Improve UI when reconnecting
* TESTS: Improve tests

# 1.8.5
* IMPORTANT DROP OF SUPPORT: Drop support for IE.  Browsers now need async/await.
* IMPORTANT SECURITY: Rate limit Commits when env=production
* SECURITY: Non completed uploads no longer crash Etherpad
* SECURITY: Log authentication requests
* FEATURE: Support ES6 (migrate from Uglify-JS to Terser)
* FEATURE: Improve support for non-cookie enabled browsers
* FEATURE: New hooks for ``index.html``
* FEATURE: New script to delete sessions.
* FEATURE: New setting to allow import withing an author session on a pad
* FEATURE: Checks Etherpad version on startup and notifies if update is available.  Also available in ``/admin`` interface.
* FEATURE: Timeslider updates pad location to most recent edit
* MINOR: Outdent UL/LI items on removal of list item
* MINOR: Various UL/LI import/export bugs
* MINOR: PDF export fix
* MINOR: Front end tests no longer run (and subsequently error) on pull requests
* MINOR: Fix issue with </li> closing a list before it opens
* MINOR: Fix bug where large pads would fire a console error in timeslider
* MINOR: Fix ?showChat URL param issue
* MINOR: Issue where timeslider URI fails to be correct if padID is numeric
* MINOR: Include prompt for clear authorship when entire document is selected
* MINOR: Include full document aText every 100 revisions to make pad restoration on database corruption achievable
* MINOR: Several Colibris CSS fixes
* MINOR: Use mime library for mime types instead of hard-coded.
* MINOR: Don't show "new pad button" if instance is read only
* MINOR: Use latest NodeJS when doing Windows build
* MINOR: Change disconnect logic to reconnect instead of silently failing
* MINOR: Update SocketIO, async, jQuery and Mocha which were stuck due to stale code.
* MINOR: Rewrite the majority of the ``bin`` scripts to use more modern syntax
* MINOR: Improved CSS anomation through prefers-reduced-motion
* PERFORMANCE: Use workers (where possible) to minify CSS/JS on first page request.  This improves initial startup times.
* PERFORMANCE: Cache EJS files improving page load speed when maxAge > 0.
* PERFORMANCE: Fix performance for large pads
* TESTS: Additional test coverage for OL/LI/Import/Export
* TESTS: Include Simulated Load Testing in CI.
* TESTS: Include content collector tests to test contentcollector.js logic external to pad dependents.
* TESTS: Include fuzzing import test.
* TESTS: Ensure CI is no longer using any cache
* TESTS: Fix various tests...
* TESTS: Various additional Travis testing including libreoffice import/export

# 1.8.4
* FIX: fix a performance regression on MySQL introduced in 1.8.3
* FIX: when running behind a reverse proxy and exposed in an inner directory, fonts and toolbar icons should now be visible. This is a regression introduced in 1.8.3
* FIX: cleanups in the UI after the CSS rehaul of 1.8.3
* MINOR: protect against bugged/stale UI elements after updates. An explicit cache busting via random query string is performed at each start. This needs to be replaced with hashed names in static assets.
* MINOR: improved some tests
* MINOR: fixed long-standing bugs in the maintenance tools in /bin (migrateDirtyDBtoRealDB, rebuildPad, convert, importSqlFile)

# 1.8.3
* FEATURE: colibris is now the default skin for new installs
* FEATURE: improved colibris visuals, and migrated to Flexbox layout
* FEATURE: skin variants: colibris skin colors can be easily customized. Visit http://127.0.0.1:9001/p/test#skinvariantsbuilder
* REQUIREMENTS: minimum required Node version is **10.13.0 LTS**.
* MINOR: stability fixes for the async migration in 1.8.0 (fixed many UnhandledPromiseRejectionWarning and the few remaining crashes)
* MINOR: improved stability of import/export functionality
* MINOR: fixed many small UI quirks (timeslider, import/export, chat)
* MINOR: Docker images are now built & run in production mode by default
* MINOR: reduced the size of the Docker images
* MINOR: better documented cookies and configuration parameters of the Docker image
* MINOR: better database support (especially MySQL)
* MINOR: additional test coverage
* MINOR: restored compatibility with ep_hash_auth
* MINOR: migrate from swagger-node-express to openapi-backend
* MINOR: honor the Accept-Language HTTP headers sent by browsers, eventually serving language variants
* PERFORMANCE: correctly send HTTP/304 for minified files
* SECURITY: bumped many dependencies. At the time of the release, this version has 0 reported vulnerabilities by npm audit
* SECURITY: never send referrer when opening a link
* SECURITY: rate limit imports and exports
* SECURITY: do not allow pad import if a user never contributed to that pad
* SECURITY: expose configuration parameter for limiting max import size

*BREAKING CHANGE*: undoing the "clear authorship colors" command is no longer supported (see https://github.com/ether/etherpad-lite/issues/2802)
*BREAKING CHANGE*: the visuals and CSS structure of the page was updated. Plugins may need a CSS rehaul

# 1.8
* SECURITY: change referrer policy so that Etherpad addresses aren't leaked when links are clicked (discussion: https://github.com/ether/etherpad-lite/pull/3636)
* SECURITY: set the "secure" flag for the session cookies when served over SSL. From now on it will not be possible to serve the same instance both in cleartext and over SSL

# 1.8-beta.1
* FEATURE: code was migrated to `async`/`await`, getting rid of a lot of callbacks (see https://github.com/ether/etherpad-lite/issues/3540)
* FEATURE: support configuration via environment variables
* FEATURE: include an official Dockerfile in the main repository
* FEATURE: support including plugins in custom Docker builds
* FEATURE: conditional creation of users: when its password is null, a user is not created. This helps, for example, in advanced configuration of Docker images.
* REQUIREMENTS: minimum required Node version is **8.9.0 LTS**. Release 1.8.3 will require at least Node **10.13.0** LTS
* MINOR: in the HTTP API, allow URL parameters and POST bodies to co-exist
* MINOR: fix Unicode bug in HTML export
* MINOR: bugfixes to colibris chat window
* MINOR: code simplification (avoided double negations, introduced early exits, ...)
* MINOR: reduced the size of the Windows package
* MINOR: upgraded the nodejs runtime to 10.16.3 in the Windows package
* SECURITY: avoided XSS in IE11
* SECURITY: the version is exposed in http header only when configured
* SECURITY: updated vendored jQuery version
* SECURITY: bumped dependencies

# 1.7.5
* FEATURE: introduced support for multiple skins. See https://etherpad.org/doc/v1.7.5/#index_skins
* FEATURE: added a new, optional skin. It can be activated choosing `skinName: "colibris"` in `settings.json`
* FEATURE: allow file import using LibreOffice
* SECURITY: updated many dependencies. No known high or moderate risk dependencies remain.
* SECURITY: generate better random pad names
* FIX: don't nuke all installed plugins if `npm install` fails
* FIX: improved LibreOffice export
* FIX: allow debug mode on node versions >= 6.3
* MINOR: started making Etherpad less dependent on current working directory when running
* MINOR: started simplifying the code structure, flattening complex conditions
* MINOR: simplified a bit the startup scripts

*UPGRADE NOTES*: if you have custom files in `src/static/custom`, save them
somewhere else, revert the directory contents, update to Etherpad 1.7.5, and
finally put them back in their new location, uder `src/static/skins/no-skin`.

# 1.7.0
* FIX: `getLineHTMLForExport()` no longer produces multiple copies of a line. **WARNING**: this could potentially break some plugins
* FIX: authorship of bullet points no longer changes when a second author edits them
* FIX: improved Firefox compatibility (non printable keys)
* FIX: `getPadPlainText()` was not working
* REQUIREMENTS: minimum required Node version is 6.9.0 LTS. The next release will require at least Node 8.9.0 LTS
* SECURITY: updated MySQL, Elasticsearch and PostgreSQL drivers
* SECURITY: started updating deprecated code and packages
* DOCS: documented --credentials, --apikey, --sessionkey. Better detailed contributors guidelines. Added a section on securing the installation

# 1.6.6
 * FIX: line numbers are aligned with text again (broken in 1.6.4)
 * FIX: text entered between connection loss and reconnection was not saved
 * FIX: diagnostic call failed when etherpad was exposed in a subdirectory

# 1.6.5
 * SECURITY: Escape data when listing available plugins
 * FIX: Fix typo in apicalls.js which prevented importing isValidJSONPName
 * FIX: fixed plugin dependency issue
 * FIX: Update iframe_editor.css
 * FIX: unbreak Safari iOS line wrapping

# 1.6.4
 * SECURITY: Access Control bypass on /admin - CVE-2018-9845
 * SECURITY: Remote Code Execution through pad export - CVE-2018-9327
 * SECURITY: Remote Code Execution through JSONP handling - CVE-2018-9326
 * SECURITY: Pad data leak - CVE-2018-9325
 * Fix: Admin redirect URL
 * Fix: Various script Fixes
 * Fix: Various CSS/Style/Layout fixes
 * NEW: Improved Pad contents readability
 * NEW: Hook: onAccessCheck
 * NEW: SESSIONKEY and APIKey customizable path
 * NEW: checkPads script
 * NEW: Support "cluster mode"

# 1.6.3
 * SECURITY: Update ejs
 * SECURITY: xss vulnerability when reading window.location.href
 * SECURITY: sanitize jsonp
 * NEW: Catch SIGTERM for graceful shutdown
 * NEW: Show actual applied text formatting for caret position
 * NEW: Add settings to improve scrolling of viewport on line changes

# 1.6.2
 * NEW: Added pad shortcut disabling feature
 * NEW: Create option to automatically reconnect after a few seconds
 * Update: socket.io to 1.7.3
 * Update: l10n lib
 * Update: request to 2.83.0
 * Update: Node for windows to 8.9.0
 * Fix: minification of code

# 1.6.1
 * NEW: Hook aceRegisterNonScrollableEditEvents to register events that shouldn't scroll
 * NEW: Added 'item' parameter to registerAceCommand Hook
 * NEW: Added LibreJS support
 * Fix: Crash on malformed export url
 * Fix: Re-enable editor after user is reconnected to server
 * Fix: minification
 * Other: Added 'no-referrer' for all pads
 * Other: Improved cookie security
 * Other: Fixed compatibility with nodejs 7
 * Other: Updates
  - socket.io to 1.6.0
  - express to 4.13.4
  - express-session to 1.13.0
  - clean-css to 3.4.12
  - uglify-js to 2.6.2
  - log4js to 0.6.35
  - cheerio to 0.20.0
  - ejs to 2.4.1
  - graceful-fs to 4.1.3
  - semver to 5.1.0
  - unorm to 1.4.1
  - jsonminify to 0.4.1
  - measured to 1.1.0
  - mocha to 2.4.5
  - supertest to 1.2.0
  - npm to 4.0.2
  - Node.js for Windows to 6.9.2

# 1.6.0
 * SECURITY: Fix a possible xss attack in iframe link
 * NEW: Add a aceSelectionChanged hook to allow plugins to react when the cursor location changes.
 * NEW: Accepting Arrays on 'exportHtmlAdditionalTags' to handle attributes stored as ['key', 'value']
 * NEW: Allow admin to run on a sub-directory
 * NEW: Support version 5 of node.js
 * NEW: Update windows build to node version 4.4.3
 * NEW: Create setting to control if a new line will be indented or not
 * NEW: Add an appendText API
 * NEW: Allow LibreOffice to be used when exporting a pad
 * NEW: Create hook exportHtmlAdditionalTagsWithData
 * NEW: Improve DB migration performance
 * NEW: allow settings to be applied from the filesystem
 * NEW: remove applySettings hook and allow credentials.json to be part of core
 * NEW: Use exec to switch to node process
 * NEW: Validate incoming color codes
 * Fix: Avoid space removal when pasting text from word processor.
 * Fix: Removing style that makes editor scroll to the top on iOS without any action from the user
 * Fix: Fix API call appendChatMessage to send new message to all connected clients
 * Fix: Timeslider "Return to pad" button
 * Fix: Generating pad HTML with tags like <span data-TAG="VALUE"> instead of <TAG:VALUE>
 * Fix: Get git commit hash even if the repo only points to a bare repo.
 * Fix: Fix decode error if pad name contains special characters and is sanitized
 * Fix: Fix handleClientMessage_USER_* payloads not containing user info
 * Fix: Set language cookie on initial load
 * Fix: Timeslider Not Translated
 * Other: set charset for mysql connection in settings.json
 * Other: Dropped support for io.js
 * Other: Add support to store credentials in credentials.json
 * Other: Support node version 4 or higher
 * Other: Update uberDB to version 0.3.0

# 1.5.7
 * NEW: Add support for intermediate CA certificates for ssl
 * NEW: Provide a script to clean up before running etherpad
 * NEW: Use ctrl+shift+1 to do a ordered list
 * NEW: Show versions of plugins on startup
 * NEW: Add author on padCreate and padUpdate hook
 * Fix: switchToPad method
 * Fix: Dead keys
 * Fix: Preserve new lines in copy-pasted text
 * Fix: Compatibility mode on IE
 * Fix: Content Collector to get the class of the DOM-node
 * Fix: Timeslider export links
 * Fix: Double prompt on file upload
 * Fix: setText() replaces the entire pad text
 * Fix: Accessibility features on embedded pads
 * Fix: Tidy HTML before abiword conversion
 * Fix: Remove edit buttons in read-only view
 * Fix: Disable user input in read-only view
 * Fix: Pads end with a single newline, rather than two newlines
 * Fix: Toolbar and chat for mobile devices

# 1.5.6
 * Fix: Error on windows installations

# 1.5.5
 * SECURITY: Also don't allow read files on directory traversal on minify paths
 * NEW: padOptions can be set in settings.json now
 * Fix: Add check for special characters in createPad API function
 * Fix: Middle click on a link in firefox don't paste text anymore
 * Fix: Made setPadRaw async to import larger etherpad files
 * Fix: rtl
 * Fix: Problem in older IEs
 * Other: Update to express 4.x
 * Other: Dropped support for node 0.8
 * Other: Update ejs to version 2.x
 * Other: Moved sessionKey from settings.json to a new auto-generated SESSIONKEY.txt file

# 1.5.4
 * SECURITY: Also don't allow read files on directory traversal on frontend tests path

# 1.5.3
 * NEW: Accessibility support for Screen readers, includes new fonts and keyboard shortcuts
 * NEW: API endpoint for Append Chat Message and Chat Backend Tests
 * NEW: Error messages displayed on load are included in Default Pad Text (can be suppressed)
 * NEW: Content Collector can handle key values
 * NEW: getAttributesOnPosition Method
 * FIX: Firefox keeps attributes (bold etc) on cut/copy -> paste
 * Fix: showControls=false now works
 * Fix: Cut and Paste works...
 * SECURITY: Don't allow read files on directory traversal

# 1.5.2
 * NEW: Support for node version 0.12.x
 * NEW: API endpoint saveRevision, getSavedRevisionCount and listSavedRevisions
 * NEW: setting to allow load testing
 * Fix: Rare scroll issue
 * Fix: Handling of custom pad path
 * Fix: Better error handling of imports and exports of type "etherpad"
 * Fix: Walking caret in chrome
 * Fix: Better handling for changeset problems
 * SECURITY Fix: Information leak for etherpad exports (CVE-2015-2298)

# 1.5.1
 * NEW: High resolution Icon
 * NEW: Use HTTPS for plugins.json download
 * NEW: Add 'last update' column
 * NEW: Show users and chat at the same time
 * NEW: Support io.js
 * Fix: removeAttributeOnLine now works properly
 * Fix: Plugin search and list
 * Fix: Issue where unauthed request could cause error
 * Fix: Privacy issue with .etherpad export
 * Fix: Freeze deps to improve bisectability
 * Fix: IE, everything. IE is so broken.
 * Fix: Timeslider proxy
 * Fix: All backend tests pass
 * Fix: Better support for Export into HTML
 * Fix: Timeslider stars
 * Fix: Translation update
 * Fix: Check filesystem if Abiword exists
 * Fix: Docs formatting
 * Fix: Move Save Revision notification to a gritter message
 * Fix: UeberDB MySQL Timeout issue
 * Fix: Indented +9 list items
 * Fix: Don't paste on middle click of link
 * SECURITY Fix: Issue where a malformed URL could cause EP to disclose installation location

# 1.5.0
 * NEW: Lots of performance improvements for page load times
 * NEW: Hook for adding CSS to Exports
 * NEW: Allow shardable socket io
 * NEW: Allow UI to show when attr/prop is applied (CSS)
 * NEW: Various scripts
 * NEW: Export full fidelity pads (including authors etc.)
 * NEW: Various front end tests
 * NEW: Backend tests
 * NEW: switchPad hook to instantly switch between pads
 * NEW: Various translations
 * NEW: Icon sets instead of images to provide quality high DPI experience
 * Fix: HTML Import blocking / hanging server
 * Fix: Export Bullet / Numbered lists HTML
 * Fix: Swagger deprecated warning
 * Fix: Bad session from crashing server
 * Fix: Allow relative settings path
 * Fix: Stop attributes being improperly assigned between 2 lines
 * Fix: Copy / Move Pad API race condition
 * Fix: Save all user preferences
 * Fix: Upgrade majority of dependency inc upgrade to SocketIO1+
 * Fix: Provide UI button to restore maximized chat window
 * Fix: Timeslider UI Fix
 * Fix: Remove Dokuwiki
 * Fix: Remove long paths from windows build (stops error during extract)
 * Fix: Various globals removed
 * Fix: Move all scripts into bin/
 * Fix: Various CSS bugfixes for Mobile devices
 * Fix: Overflow Toolbar
 * Fix: Line Attribute management

# 1.4.1
 * NEW: Translations
 * NEW: userLeave Hook
 * NEW: Script to reinsert all DB values of a Pad
 * NEW: Allow for absolute settings paths
 * NEW: API: Get Pad ID from read Only Pad ID
 * NEW: Huge improvement on MySQL database read/write (InnoDB to MyISAM)
 * NEW: Hook for Export File Name
 * NEW: Preprocessor Hook for DOMLine attributes (allows plugins to wrap entire line contents)
 * Fix: Exception on Plugin Search and fix for plugins not being fetched
 * Fix: Font on innerdoc body can be arial on paste
 * Fix: Fix Dropping of messages in handleMessage
 * Fix: Don't use Abiword for HTML exports
 * Fix: Color issues with user Icon
 * Fix: Timeslider Button
 * Fix: Session Deletion error
 * Fix: Allow browser tabs to be cycled when focus is in editor
 * Fix: Various Editor issues with Easysync potentially entering forever loop on bad changeset

# 1.4
 * NEW: Disable toolbar items through settings.json
 * NEW: Internal stats/metrics engine
 * NEW: Copy/Move Pad API functions
 * NEW: getAttributeOnSelection method
 * NEW: CSS function when an attribute is active on caret location
 * NEW: Various new eejs blocks
 * NEW: Ace afterEditHook
 * NEW: Import hook to introduce alternative export methods
 * NEW: preProcessDomLine allows Domline attributes to be processed before native attributes
 * Fix: Allow for lighter author colors
 * Fix: Improved randomness of session tokens
 * Fix: Don't panic if an author2session/group2session no longer exists
 * Fix: Gracefully fallback to related languages if chosen language is unavailable
 * Fix: Various changeset/stability bugs
 * Fix: Re-enable import buttons after failed import
 * Fix: Allow browser tabs to be cycled when in editor
 * Fix: Better Protocol detection
 * Fix: padList API Fix
 * Fix: Caret walking issue
 * Fix: Better settings.json parsing
 * Fix: Improved import/export handling
 * Other: Various whitespace/code clean-up
 * Other: .deb packaging creator
 * Other: More API Documentation
 * Other: Lots more translations
 * Other: Support Node 0.11

# 1.3
 * NEW: We now follow the semantic versioning scheme!
 * NEW: Option to disable IP logging
 * NEW: Localisation updates from https://translatewiki.net.
 * Fix: Fix readOnly group pads
 * Fix: don't fetch padList on every request

# 1.2.12
 * NEW: Add explanations for more disconnect scenarios
 * NEW: export sessioninfos so plugins can access it
 * NEW: pass pad in postAceInit hook
 * NEW: Add trustProxy setting. ALlows to make ep use X-forwarded-for as remoteAddress
 * NEW: userLeave hook (UNDOCUMENTED)
 * NEW: Plural macro for translations
 * NEW: backlinks to main page in Admin pages
 * NEW: New translations from translatewiki.net
 * SECURITY FIX: Filter author data sent to clients
 * FIX: Never keep processing a changeset if it's corrupted
 * FIX: Some client-side performance fixes for webkit browsers
 * FIX: Only execute listAllPads query on demand (not on start-up)
 * FIX: HTML import (don't crash on malformed or blank HTML input; strip title out of html during import)
 * FIX: check if uploaded file only contains ascii chars when abiword disabled
 * FIX: Plugin search in /admin/plugins
 * FIX: Don't create new pad if a non-existent read-only pad is accessed
 * FIX: Drop messages from unknown connections (would lead to a crash after a restart)
 * FIX: API: fix createGroupFor endpoint, if mapped group is deleted
 * FIX: Import form for other locales
 * FIX: Don't stop processing changeset queue if there is an error
 * FIX: Caret movement. Chrome detects blank rows line heights as incorrect
 * FIX: allow colons in password
 * FIX: Polish logging of client-side errors on the server
 * FIX: Username url param
 * FIX: Make start script POSIX ompatible


# 1.2.11
 * NEW: New Hook for outer_ace dynamic css manager and author style hook
 * NEW: Bump log4js for improved logging
 * Fix: Remove URL schemes which don't have RFC standard
 * Fix: Fix safeRun subsequent restarts issue
 * Fix: Allow safeRun to pass arguments to run.sh
 * Fix: Include script for more efficient import
 * Fix: Fix sysv comptibile script
 * Fix: Fix client side changeset spamming
 * Fix: Don't crash on no-auth
 * Fix: Fix some IE8 errors
 * Fix: Fix authorship sanitation

# 1.2.10
 * NEW: Broadcast slider is exposed in timeslider so plugins can interact with it
 * Fix: IE issue where pads wouldn't load due to missing console from i18n
 * Fix: console issue in collab client would error on cross domain embeds in IE
 * Fix: Only Restart Etherpad once plugin is installed
 * Fix: Only redraw lines that exist after drag and drop
 * Fix: Pasting into ordered list
 * Fix: Import browser detection
 * Fix: 2 Part Locale Specs
 * Fix: Remove language string from chat element
 * Fix: Make Saved revision Star fade back out on non Top frames
 * Other: Remove some cruft legacy JS from old Etherpad
 * Other: Express 3.1.2 breaks sessions, set Express to 3.1.0

# 1.2.91
 * NEW: Authors can now send custom object messages to other Authors making 3 way conversations possible.  This introduces WebRTC plugin support.
 * NEW: Hook for Chat Messages Allows for Desktop Notification support
 * NEW: FreeBSD installation docs
 * NEW: Ctrl S for save revision makes the Icon glow for a few sconds.
 * NEW: Various hooks and expose the document ACE object
 * NEW: Plugin page revamp makes finding and installing plugins more sane.
 * NEW: Icon to enable sticky chat from the Chat box
 * Fix: Cookies inside of plugins
 * Fix: Don't leak event emitters when accessing admin/plugins
 * Fix: Don't allow user to send messages after they have been "kicked" from a pad
 * Fix: Refactor Caret navigation with Arrow and Pageup/down keys stops cursor being lost
 * Fix: Long lines in Firefox now wrap properly
 * Fix: Session Disconnect limit is increased from 10 to 20 to support slower restarts
 * Fix: Support Node 0.10
 * Fix: Log HTTP on DEBUG log level
 * Fix: Server wont crash on import fails on 0 file import.
 * Fix: Import no longer fails consistently
 * Fix: Language support for non existing languages
 * Fix: Mobile support for chat notifications are now usable
 * Fix: Re-Enable Editbar buttons on reconnect
 * Fix: Clearing authorship colors no longer disconnects all clients
 * Other: New debug information for sessions

# 1.2.9
 * Fix: MAJOR Security issue, where a hacker could submit content as another user
 * Fix: security issue due to unescaped user input
 * Fix: Admin page at /admin redirects to /admin/ now to prevent breaking relative links
 * Fix: indentation in chrome on linux
 * Fix: PadUsers API endpoint
 * NEW: A script to import data to all dbms
 * NEW: Add authorId to chat and userlist as a data attribute
 * NEW: Refactor and fix our frontend tests
 * NEW: Localisation updates


# 1.2.81
 * Fix: CtrlZ-Y for Undo Redo
 * Fix: RTL functionality on contents & fix RTL/LTR tests and RTL in Safari
 * Fix: Various other tests fixed in Android

# 1.2.8
 ! IMPORTANT: New setting.json value is required to automatically reconnect clients on disconnect
 * NEW: Use Socket IO for rooms (allows for pads to be load balanced with sticky rooms)
 * NEW: Plugins can now provide their own frontend tests
 * NEW: Improved server-side logging
 * NEW: Admin dashboard mobile device support and new hooks for Admin dashboard
 * NEW: Get current API version from API
 * NEW: CLI script to delete pads
 * Fix: Automatic client reconnection on disconnect
 * Fix: Text Export indentation now supports multiple indentations
 * Fix: Bugfix getChatHistory API method
 * Fix: Stop Chrome losing caret after paste is texted
 * Fix: Make colons on end of line create 4 spaces on indent
 * Fix: Stop the client disconnecting if a rev is in the wrong order
 * Fix: Various server crash issues based on rev in wrong order
 * Fix: Various tests
 * Fix: Make indent when on middle of the line stop creating list
 * Fix: Stop long strings breaking the UX by moving focus away from beginning of line
 * Fix: Redis findKeys support
 * Fix: padUsersCount no longer hangs server
 * Fix: Issue with two part locale specs not working
 * Fix: Make plugin search case insensitive
 * Fix: Indentation and bullets on text export
 * Fix: Resolve various warnings on dependencies during install
 * Fix: Page up / Page down now works in all browsers
 * Fix: Stop Opera browser inserting two new lines on enter keypress
 * Fix: Stop timeslider from showing NaN on pads with only one revision
 * Other: Allow timeslider tests to run and provide & fix various other frontend-tests
 * Other: Begin dropping reference to Lite.  Etherpad Lite is now named "Etherpad"
 * Other: Update to latest jQuery
 * Other: Change loading message asking user to please wait on first build
 * Other: Allow etherpad to use global npm installation (Safe since node 6.3)
 * Other: Better documentation for log rotation and log message handling



# 1.2.7
 * NEW: notifications are now modularized and can be stacked
 * NEW: Visit a specific revision in the timeslider by suffixing #%revNumber% IE http://localhost/p/test/timeslider#12
 * NEW: Link to plugin on Admin page allows admins to easily see plugin details in a new window by clicking on the plugin name
 * NEW: Automatically see plugins that require update and be able to one click update
 * NEW: API endpoints for Chat .. getChatHistory, getChatHead
 * NEW: API endpoint to see a pad diff in HTML format from revision x to revision y .. createPadDiffHTML
 * NEW: Real time plugin search & unified menu UI for admin pages
 * Fix: MAJOR issue where server could be crashed by malformed client message
 * Fix: AuthorID is now included in padUsers API response
 * Fix: make docs
 * Fix: Timeslider UI bug with slider not being in position
 * Fix: IE8 language issue where it wouldn't load pads due to IE8 suckling on the bussum of hatrid
 * Fix: Import timeout issue
 * Fix: Import now works if Params are set in pad URL
 * Fix: Convert script
 * Other: Various new language strings and update/bugfixes of others
 * Other: Clean up the getParams functionality
 * Other: Various new EEJS blocks: index, timeslider, html etc.

# 1.2.6
 * Fix: Package file UeberDB reference
 * New #users EEJS block for plugins

# 1.2.5
 * Create timeslider EEJS blocks for plugins
 * Allow for "more messages" to be loaded in chat
 * Introduce better logging
 * API endpoint for "listAllPads"
 * Fix: Stop highlight of timeslider when dragging mouse
 * Fix: Time Delta on Timeslider make date update properly
 * Fix: Prevent empty chat messages from being sent
 * Fix: checkPad script
 * Fix: IE onLoad listener for i18n

# 1.2.4
 * Fix IE console issue created in 1.2.3
 * Allow CI Tests to pass by ignoring timeslider test
 * Fix broken placeholders in locales
 * Fix extractPadData script
 * Fix documentation for checkToken
 * Fix hitting enter on form in admin/plugins

# 1.2.3
 * Fix #1307: Chrome needs console.log to be called on console obj
 * Fix #1309: We had broken support for node v0.6 in the last release

# 1.2.2
 * More translations and better language support.  See https://translatewiki.net/wiki/Translating:Etherpad_lite for more details
 * Add a checkToken Method to the API
 * Bugfix for Internal Caching issue that was causing some 404s on images.
 * Bugfix for IE Import
 * Bugfix for Node 0.6 compatibility
 * Bugfix for multiple cookie support
 * Bugfix for API when requireAuth is enabled.
 * Plugin page now shows plugin version #
 * Show color of Author in Chat messages
 * Allow plugin search by description
 * Allow for different socket IO transports
 * Allow for custom favicon path
 * Control S now does Create new Revision functionality
 * Focus on password when required
 * Frontend Timeslider test
 * Allow for basic HTML etc. import without abiword
 * Native HTTPS support

# 1.2.1
 * Allow ! in urls inside the editor (Not Pad urls)
 * Allow comments in language files
 * More languages (Finish, Spanish, Bengali, Dutch) Thanks to TranslateWiki.net team.  See https://translatewiki.net/w/i.php?title=Special:MessageGroupStats&group=out-etherpad-lite for more details
 * Bugfix for IE7/8 issue with a JS error #1186
 * Bugfix windows package extraction issue and make the .zip file smaller
 * Bugfix group pad API export
 * Kristen Stewart is a terrible actress and Twilight sucks.

# v1.2
 * Internationalization / Language / Translation support (i18n) with support for German/French
 * A frontend/client side testing framework and backend build tests
 * Customizable robots.txt
 * Customizable app title (finally you can name your epl instance!)
 * eejs render arguments are now passed on to eejs hooks through the newly introduced `renderContext` argument.
 * Plugin-specific settings in settings.json (finally allowing for things like a google analytics plugin)
 * Serve admin dashboard at /admin (still very limited, though)
 * Modify your settings.json through the newly created UI at /admin/settings
 * Fix: Import `<ol>` as `<ol>` and not as `<ul>`!
 * Added solaris compatibility (bin/installDeps.sh was broken on solaris)
 * Fix a bug with IE9 and Password Protected Pads using HTTPS

# v1.1.5
 * We updated to express v3 (please [make sure](https://github.com/visionmedia/express/wiki/Migrating-from-2.x-to-3.x) your plugin works under express v3)
 * `userColor` URL parameter which sets the initial author color
 * Hooks for "padCreate", "padRemove", "padUpdate" and "padLoad" events
 * Security patches concerning the handling of messages originating from clients
 * Our database abstraction layer now natively supports couchDB, levelDB, mongoDB, postgres, and redis!
 * We now provide a script helping you to migrate from dirtyDB to MySQL
 * Support running Etherpad Lite behind IIS, using [iisnode](https://github.com/tjanczuk/iisnode/wiki)
 * LibreJS Licensing information in headers of HTML templates
 * Default port number to PORT env var, if port isn't specified in settings
 * Fix for `convert.js`
 * Raise upper char limit in chat to 999 characters
 * Fixes for mobile layout
 * Fixes for usage behind reverse proxy
 * Improved documentation
 * Fixed some opera style bugs
 * Update npm and fix some bugs, this introduces

# v1.1
* Introduced Plugin framework
* Many bugfixes
* Faster page loading
* Various UI polishes
* Saved Revisions
* Read only Real time view
* More API functionality

# v 1.0.1

* Updated MySQL driver, this fixes some problems with mysql
* Fixed export,import and timeslider link when embed parameters are used
