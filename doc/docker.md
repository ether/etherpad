# Docker

The official Docker image is available on https://hub.docker.com/r/etherpad/etherpad.

## Downloading from Docker Hub
If you are ok downloading a [prebuilt image from Docker Hub](https://hub.docker.com/r/etherpad/etherpad), these are the commands:
```bash
# gets the latest published version
docker pull etherpad/etherpad

# gets a specific version
docker pull etherpad/etherpad:1.8.0
```

## Build a personalized container

If you want to use a personalized settings file, **you will have to rebuild your image**.
All of the following instructions are as a member of the `docker` group.
By default, the Etherpad Docker image is built and run in `production` mode: no development dependencies are installed, and asset bundling speeds up page load time.

### Rebuilding with custom settings
Edit `<BASEDIR>/settings.json.docker` at your will. When rebuilding the image, this file will be copied inside your image and renamed to `settings.json`.

**Each configuration parameter can also be set via an environment variable**, using the syntax `"${ENV_VAR}"` or `"${ENV_VAR:default_value}"`. For details, refer to `settings.json.template`.

### Rebuilding including some plugins
If you want to install some plugins in your container, it is sufficient to list them in the ETHERPAD_PLUGINS build variable.
The variable value has to be a space separated, double quoted list of plugin names (see examples).

Some plugins will need personalized settings. Just refer to the previous section, and include them in your custom `settings.json.docker`.

### Rebuilding including export functionality for DOC/PDF/ODT

If you want to be able to export your pads to DOC/PDF/ODT files, you can install
either Abiword or Libreoffice via setting a build variable.

#### Via Abiword

For installing Abiword, set the `INSTALL_ABIWORD` build variable to any value.

Also, you will need to configure the path to the abiword executable
via setting the `abiword` property in `<BASEDIR>/settings.json.docker` to
`/usr/bin/abiword` or via setting the environment variable  `ABIWORD` to
`/usr/bin/abiword`.

#### Via Libreoffice

For installing Libreoffice instead, set the `INSTALL_SOFFICE` build variable
to any value.

Also, you will need to configure the path to the libreoffice executable
via setting the `soffice` property in `<BASEDIR>/settings.json.docker` to
`/usr/bin/soffice` or via setting the environment variable  `SOFFICE` to
`/usr/bin/soffice`.

### Examples

Build a Docker image from the currently checked-out code:
```bash
docker build --tag <YOUR_USERNAME>/etherpad .
```

Include two plugins in the container:
```bash
docker build --build-arg ETHERPAD_PLUGINS="ep_comments_page ep_author_neat" --tag <YOUR_USERNAME>/etherpad .
```

## Running your instance:

To run your instance:
```bash
docker run --detach --publish <DESIRED_PORT>:9001 <YOUR_USERNAME>/etherpad
```

And point your browser to `http://<YOUR_IP>:<DESIRED_PORT>`

## Options available by default

The `settings.json.docker` available by default allows to control almost every setting via environment variables.

### General

| Variable           | Description                                                                                | Default                                                                                                                                                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TITLE`            | The name of the instance                                                                   | `Etherpad`                                                                                                                                                                                                                          |
| `FAVICON`          | favicon default name, or a fully specified URL to your own favicon                         | `favicon.ico`                                                                                                                                                                                                                       |
| `DEFAULT_PAD_TEXT` | The default text of a pad                                                                  | `Welcome to Etherpad! This pad text is synchronized as you type, so that everyone viewing this page sees the same text. This allows you to collaborate seamlessly on documents! Get involved with Etherpad at https://etherpad.org` |
| `IP`               | IP which etherpad should bind at. Change to `::` for IPv6                                  | `0.0.0.0`                                                                                                                                                                                                                           |
| `PORT`             | port which etherpad should bind at                                                         | `9001`                                                                                                                                                                                                                              |
| `ADMIN_PASSWORD`   | the password for the `admin` user (leave unspecified if you do not want to create it)      |                                                                                                                                                                                                                                     |
| `USER_PASSWORD`    | the password for the first user `user` (leave unspecified if you do not want to create it) |                                                                                                                                                                                                                                     |


### Database

| Variable      | Description                                                    | Default                                                               |
| ------------- | -------------------------------------------------------------- | --------------------------------------------------------------------- |
| `DB_TYPE`     | a database supported by https://www.npmjs.com/package/ueberdb2 | not set, thus will fall back to `DirtyDB` (please choose one instead) |
| `DB_HOST`     | the host of the database                                       |                                                                       |
| `DB_PORT`     | the port of the database                                       |                                                                       |
| `DB_NAME`     | the database name                                              |                                                                       |
| `DB_USER`     | a database user with sufficient permissions to create tables   |                                                                       |
| `DB_PASS`     | the password for the database username                         |                                                                       |
| `DB_CHARSET`  | the character set for the tables (only required for MySQL)     |                                                                       |
| `DB_FILENAME` | in case `DB_TYPE` is `DirtyDB` or `sqlite`, the database file. | `var/dirty.db`, `var/etherpad.sq3`                                    |

If your database needs additional settings, you will have to use a personalized `settings.json.docker` and rebuild the container (or otherwise put the updated `settings.json` inside your image).


### Pad Options

| Variable                         | Description | Default |
| -------------------------------- | ----------- | ------- |
| `PAD_OPTIONS_NO_COLORS`          |             | `false` |
| `PAD_OPTIONS_SHOW_CONTROLS`      |             | `true`  |
| `PAD_OPTIONS_SHOW_CHAT`          |             | `true`  |
| `PAD_OPTIONS_SHOW_LINE_NUMBERS`  |             | `true`  |
| `PAD_OPTIONS_USE_MONOSPACE_FONT` |             | `false` |
| `PAD_OPTIONS_USER_NAME`          |             | `null`  |
| `PAD_OPTIONS_USER_COLOR`         |             | `null`  |
| `PAD_OPTIONS_RTL`                |             | `false` |
| `PAD_OPTIONS_ALWAYS_SHOW_CHAT`   |             | `false` |
| `PAD_OPTIONS_CHAT_AND_USERS`     |             | `false` |
| `PAD_OPTIONS_LANG`               |             | `null`  |


### Shortcuts

| Variable                            | Description                                      | Default |
| ----------------------------------- | ------------------------------------------------ | ------- |
| `PAD_SHORTCUTS_ENABLED_ALT_F9`      | focus on the File Menu and/or editbar            | `true`  |
| `PAD_SHORTCUTS_ENABLED_ALT_C`       | focus on the Chat window                         | `true`  |
| `PAD_SHORTCUTS_ENABLED_CMD_S`       | save a revision                                  | `true`  |
| `PAD_SHORTCUTS_ENABLED_CMD_Z`       | undo/redo                                        | `true`  |
| `PAD_SHORTCUTS_ENABLED_CMD_Y`       | redo                                             | `true`  |
| `PAD_SHORTCUTS_ENABLED_CMD_I`       | italic                                           | `true`  |
| `PAD_SHORTCUTS_ENABLED_CMD_B`       | bold                                             | `true`  |
| `PAD_SHORTCUTS_ENABLED_CMD_U`       | underline                                        | `true`  |
| `PAD_SHORTCUTS_ENABLED_CMD_H`       | backspace                                        | `true`  |
| `PAD_SHORTCUTS_ENABLED_CMD_5`       | strike through                                   | `true`  |
| `PAD_SHORTCUTS_ENABLED_CMD_SHIFT_1` | ordered list                                     | `true`  |
| `PAD_SHORTCUTS_ENABLED_CMD_SHIFT_2` | shows a gritter popup showing a line author      | `true`  |
| `PAD_SHORTCUTS_ENABLED_CMD_SHIFT_L` | unordered list                                   | `true`  |
| `PAD_SHORTCUTS_ENABLED_CMD_SHIFT_N` | ordered list                                     | `true`  |
| `PAD_SHORTCUTS_ENABLED_CMD_SHIFT_C` | clear authorship                                 | `true`  |
| `PAD_SHORTCUTS_ENABLED_DELETE`      |                                                  | `true`  |
| `PAD_SHORTCUTS_ENABLED_RETURN`      |                                                  | `true`  |
| `PAD_SHORTCUTS_ENABLED_ESC`         | in mozilla versions 14-19 avoid reconnecting pad | `true`  |
| `PAD_SHORTCUTS_ENABLED_TAB`         | indent                                           | `true`  |
| `PAD_SHORTCUTS_ENABLED_CTRL_HOME`   | scroll to top of pad                             | `true`  |
| `PAD_SHORTCUTS_ENABLED_PAGE_UP`     |                                                  | `true`  |
| `PAD_SHORTCUTS_ENABLED_PAGE_DOWN`   |                                                  | `true`  |


### Skins

You can use the UI skin variants builder at `/p/test#skinvariantsbuilder`

For the colibris skin only, you can choose how to render the three main containers:
* toolbar (top menu with icons)
* editor (containing the text of the pad)
* background (area outside of editor, mostly visible when using page style)

For each of the 3 containers you can choose 4 color combinations:
* super-light
* light
* dark
* super-dark

For the editor container, you can also make it full width by adding `full-width-editor` variant (by default editor is rendered as a page, with a max-width of 900px).

| Variable        | Description                                                                    | Default                                                   |
| --------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------- |
| `SKIN_NAME`     | either `no-skin`, `colibris` or an existing directory under `src/static/skins` | `colibris`                                                |
| `SKIN_VARIANTS` | multiple skin variants separated by spaces                                     | `super-light-toolbar super-light-editor light-background` |


### Logging

| Variable             | Description                                          | Default |
| -------------------- | ---------------------------------------------------- | ------- |
| `LOGLEVEL`           | valid values are `DEBUG`, `INFO`, `WARN` and `ERROR` | `INFO`  |
| `DISABLE_IP_LOGGING` | Privacy: disable IP logging                          | `false` |


### Advanced

| Variable                          | Description                                                                                                                                                                                            | Default               |
|-----------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-----------------------|
| `COOKIE_SAME_SITE`                | Value of the SameSite cookie property.                                                                                                                                                                 | `"Lax"`               |
| `COOKIE_SESSION_LIFETIME`         | How long (ms) a user can be away before they must log in again.                                                                                                                                        | `864000000` (10 days) |
| `COOKIE_SESSION_REFRESH_INTERVAL` | How often (ms) to write the latest cookie expiration time.                                                                                                                                             | `86400000` (1 day)    |
| `SHOW_SETTINGS_IN_ADMIN_PAGE`     | hide/show the settings.json in admin page                                                                                                                                                              | `true`                |
| `TRUST_PROXY`                     | set to `true` if you are using a reverse proxy in front of Etherpad (for example: Traefik for SSL termination via Let's Encrypt). This will affect security and correctness of the logs if not done    | `false`               |
| `IMPORT_MAX_FILE_SIZE`            | maximum allowed file size when importing a pad, in bytes.                                                                                                                                              | `52428800` (50 MB)    |
| `IMPORT_EXPORT_MAX_REQ_PER_IP`    | maximum number of import/export calls per IP.                                                                                                                                                          | `10`                  |
| `IMPORT_EXPORT_RATE_LIMIT_WINDOW` | the call rate for import/export requests will be estimated in this time window (in milliseconds)                                                                                                       | `90000`               |
| `COMMIT_RATE_LIMIT_DURATION`      | duration of the rate limit window for commits by individual users/IPs (in seconds)                                                                                                                     | `1`                   |
| `COMMIT_RATE_LIMIT_POINTS`        | maximum number of changes per IP to allow during the rate limit window                                                                                                                                 | `10`                  |
| `SUPPRESS_ERRORS_IN_PAD_TEXT`     | Should we suppress errors from being visible in the default Pad Text?                                                                                                                                  | `false`               |
| `REQUIRE_SESSION`                 | If this option is enabled, a user must have a session to access pads. This effectively allows only group pads to be accessed.                                                                          | `false`               |
| `EDIT_ONLY`                       | Users may edit pads but not create new ones. Pad creation is only via the API. This applies both to group pads and regular pads.                                                                       | `false`               |
| `MINIFY`                          | If true, all css & js will be minified before sending to the client. This will improve the loading performance massively, but makes it difficult to debug the javascript/css                           | `true`                |
| `MAX_AGE`                         | How long may clients use served javascript code (in seconds)? Not setting this may cause problems during deployment. Set to 0 to disable caching.                                                      | `21600` (6 hours)     |
| `ABIWORD`                         | Absolute path to the Abiword executable. Abiword is needed to get advanced import/export features of pads. Setting it to null disables Abiword and will only allow plain text and HTML import/exports. | `null`                |
| `SOFFICE`                         | This is the absolute path to the soffice executable. LibreOffice can be used in lieu of Abiword to export pads. Setting it to null disables LibreOffice exporting.                                     | `null`                |
| `ALLOW_UNKNOWN_FILE_ENDS`         | Allow import of file types other than the supported ones: txt, doc, docx, rtf, odt, html & htm                                                                                                         | `true`                |
| `REQUIRE_AUTHENTICATION`          | This setting is used if you require authentication of all users. Note: "/admin" always requires authentication.                                                                                        | `false`               |
| `REQUIRE_AUTHORIZATION`           | Require authorization by a module, or a user with is_admin set, see below.                                                                                                                             | `false`               |
| `AUTOMATIC_RECONNECTION_TIMEOUT`  | Time (in seconds) to automatically reconnect pad when a "Force reconnect" message is shown to user. Set to 0 to disable automatic reconnection.                                                        | `0`                   |
| `FOCUS_LINE_PERCENTAGE_ABOVE`     | Percentage of viewport height to be additionally scrolled. e.g. 0.5, to place caret line in the middle of viewport, when user edits a line above of the viewport. Set to 0 to disable extra scrolling  | `0`                   |
| `FOCUS_LINE_PERCENTAGE_BELOW`     | Percentage of viewport height to be additionally scrolled. e.g. 0.5, to place caret line in the middle of viewport, when user edits a line below of the viewport. Set to 0 to disable extra scrolling  | `0`                   |
| `FOCUS_LINE_PERCENTAGE_ARROW_UP`  | Percentage of viewport height to be additionally scrolled when user presses arrow up in the line of the top of the viewport. Set to 0 to let the scroll to be handled as default by Etherpad           | `0`                   |
| `FOCUS_LINE_DURATION`             | Time (in milliseconds) used to animate the scroll transition. Set to 0 to disable animation                                                                                                            | `0`                   |
| `FOCUS_LINE_CARET_SCROLL`         | Flag to control if it should scroll when user places the caret in the last line of the viewport                                                                                                        | `false`               |
| `SOCKETIO_MAX_HTTP_BUFFER_SIZE`   | The maximum size (in bytes) of a single message accepted via Socket.IO. If a client sends a larger message, its connection gets closed to prevent DoS (memory exhaustion) attacks.                     | `50000`               |
| `LOAD_TEST`                       | Allow Load Testing tools to hit the Etherpad Instance. WARNING: this will disable security on the instance.                                                                                            | `false`               |
| `DUMP_ON_UNCLEAN_EXIT`            | Enable dumping objects preventing a clean exit of Node.js. WARNING: this has a significant performance impact.                                                                                         | `false`               |
| `EXPOSE_VERSION`                  | Expose Etherpad version in the web interface and in the Server http header. Do not enable on production machines.                                                                                      | `false`               |

### Add plugin configurations

It is possible to add arbitrary configurations for plugins by setting the `EP__PLUGIN__<PLUGIN_NAME>__<CONFIG_NAME>` environment variable. It is important to separate paths with a double underscore `__`.

For example, to configure the `ep_comments` plugin to use the `comments` database, you can set the following environment variables:

The original config looks like this:
```json
"ep_comments_page": {
  "highlightSelectedText": true
},
```
We have two paths ep_comments_page and highlightSelectedText, so we need to set the following environment variable:


```yaml
EP__ep_comments_page__highlightSelectedText=true
```

### Examples

Use a Postgres database, no admin user enabled:

```shell
docker run -d \
	--name etherpad         \
	-p 9001:9001            \
	-e 'DB_TYPE=postgres'   \
	-e 'DB_HOST=db.local'   \
	-e 'DB_PORT=4321'       \
	-e 'DB_NAME=etherpad'   \
	-e 'DB_USER=dbusername' \
	-e 'DB_PASS=mypassword' \
	etherpad/etherpad
```

Run enabling the administrative user `admin`:

```shell
docker run -d \
	--name etherpad \
	-p 9001:9001 \
	-e 'ADMIN_PASSWORD=supersecret' \
	etherpad/etherpad
```

Run a test instance running DirtyDB on a persistent volume:

```shell
docker run -d \
	-v etherpad_data:/opt/etherpad-lite/var \
	-p 9001:9001 \
	etherpad/etherpad
```



## Ready to use Docker Compose

```yaml
services:
  app:
    user: "0:0"
    image: etherpad/etherpad:latest
    tty: true
    stdin_open: true
    volumes:
      - plugins:/opt/etherpad-lite/src/plugin_packages
      - etherpad-var:/opt/etherpad-lite/var
    depends_on:
      - postgres
    environment:
      NODE_ENV: production
      ADMIN_PASSWORD: ${DOCKER_COMPOSE_APP_ADMIN_PASSWORD:-admin}
      DB_CHARSET: ${DOCKER_COMPOSE_APP_DB_CHARSET:-utf8mb4}
      DB_HOST: postgres
      DB_NAME: ${DOCKER_COMPOSE_POSTGRES_DATABASE:-etherpad}
      DB_PASS: ${DOCKER_COMPOSE_POSTGRES_PASSWORD:-admin}
      DB_PORT: ${DOCKER_COMPOSE_POSTGRES_PORT:-5432}
      DB_TYPE: "postgres"
      DB_USER: ${DOCKER_COMPOSE_POSTGRES_USER:-admin}
      # For now, the env var DEFAULT_PAD_TEXT cannot be unset or empty; it seems to be mandatory in the latest version of etherpad
      DEFAULT_PAD_TEXT: ${DOCKER_COMPOSE_APP_DEFAULT_PAD_TEXT:- }
      DISABLE_IP_LOGGING: ${DOCKER_COMPOSE_APP_DISABLE_IP_LOGGING:-false}
      SOFFICE: ${DOCKER_COMPOSE_APP_SOFFICE:-null}
      TRUST_PROXY: ${DOCKER_COMPOSE_APP_TRUST_PROXY:-true}
    restart: always
    ports:
      - "${DOCKER_COMPOSE_APP_PORT_PUBLISHED:-9001}:${DOCKER_COMPOSE_APP_PORT_TARGET:-9001}"

  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: ${DOCKER_COMPOSE_POSTGRES_DATABASE:-etherpad}
      POSTGRES_PASSWORD: ${DOCKER_COMPOSE_POSTGRES_PASSWORD:-admin}
      POSTGRES_PORT: ${DOCKER_COMPOSE_POSTGRES_PORT:-5432}
      POSTGRES_USER: ${DOCKER_COMPOSE_POSTGRES_USER:-admin}
      PGDATA: /var/lib/postgresql/data/pgdata
    restart: always
    # Exposing the port is not needed unless you want to access this database instance from the host.
    # Be careful when other postgres docker container are running on the same port
    # ports:
    #   - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data/pgdata

volumes:
  postgres_data:
  plugins:
  etherpad-var:
```
