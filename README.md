# Etherpad: A real-time collaborative editor for the web

![Demo Etherpad Animated Jif](doc/public/etherpad_demo.gif "Etherpad in action")

## About

Etherpad is a real-time collaborative editor [scalable to thousands of
simultaneous real time users](http://scale.etherpad.org/). It provides [full
data
export](https://github.com/ether/etherpad-lite/wiki/Understanding-Etherpad's-Full-Data-Export-capabilities)
capabilities, and runs on _your_ server, under _your_ control.

## Try it out

Wikimedia provide a [public Etherpad instance for you to Try Etherpad out.](https://etherpad.wikimedia.org) or [use another public Etherpad instance to see other features](https://github.com/ether/etherpad-lite/wiki/Sites-That-Run-Etherpad#sites-that-run-etherpad)

## Project Status

We're looking for maintainers and have some funding available.  Please contact John McLear if you can help.

### Code Quality

[![Code Quality](https://github.com/ether/etherpad-lite/actions/workflows/codeql-analysis.yml/badge.svg?color=%2344b492)](https://github.com/ether/etherpad-lite/actions/workflows/codeql-analysis.yml)

### Testing

[![Backend tests](https://github.com/ether/etherpad-lite/actions/workflows/backend-tests.yml/badge.svg?color=%2344b492)](https://github.com/ether/etherpad-lite/actions/workflows/backend-tests.yml)
[![Simulated Load](https://github.com/ether/etherpad-lite/actions/workflows/load-test.yml/badge.svg?color=%2344b492)](https://github.com/ether/etherpad-lite/actions/workflows/load-test.yml)
[![Rate Limit](https://github.com/ether/etherpad-lite/actions/workflows/rate-limit.yml/badge.svg?color=%2344b492)](https://github.com/ether/etherpad-lite/actions/workflows/rate-limit.yml)
[![Docker file](https://github.com/ether/etherpad-lite/actions/workflows/dockerfile.yml/badge.svg?color=%2344b492)](https://github.com/ether/etherpad-lite/actions/workflows/dockerfile.yml)
[![Frontend admin tests powered by Sauce Labs](https://github.com/ether/etherpad-lite/actions/workflows/frontend-admin-tests.yml/badge.svg?color=%2344b492)](https://github.com/ether/etherpad-lite/actions/workflows/frontend-admin-tests.yml)
[![Frontend tests powered by Sauce Labs](https://github.com/ether/etherpad-lite/actions/workflows/frontend-tests.yml/badge.svg?color=%2344b492)](https://github.com/ether/etherpad-lite/actions/workflows/frontend-tests.yml)
[![Sauce Test Status](https://saucelabs.com/buildstatus/etherpad.svg)](https://saucelabs.com/u/etherpad)
[![Windows Build](https://github.com/ether/etherpad-lite/actions/workflows/windows.yml/badge.svg?color=%2344b492)](https://github.com/ether/etherpad-lite/actions/workflows/windows.yml)

### Engagement

[![Docker Pulls](https://img.shields.io/docker/pulls/etherpad/etherpad?color=%2344b492)](https://hub.docker.com/r/etherpad/etherpad)
[![Discord](https://img.shields.io/discord/741309013593030667?color=%2344b492)](https://discord.com/invite/daEjfhw)
[![Etherpad plugins](https://img.shields.io/endpoint?url=https%3A%2F%2Fstatic.etherpad.org%2Fshields.json&color=%2344b492 "Etherpad plugins")](https://static.etherpad.org/index.html)
![Languages](https://img.shields.io/static/v1?label=Languages&message=105&color=%2344b492)
![Translation Coverage](https://img.shields.io/static/v1?label=Languages&message=98%&color=%2344b492)

## Installation

### Docker-Compose

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
      - postgres_data:/var/lib/postgresql/data

volumes:
  postgres_data:
  plugins:
  etherpad-var:
```

### Requirements

[Node.js](https://nodejs.org/) >= **18.18.2**.

### Windows, macOS, Linux

1. Download the latest Node.js runtime from [nodejs.org](https://nodejs.org/).
2. Install pnpm: `npm install -g pnpm` (Administrator privileges may be required).
3. Clone the repository: `git clone -b master`
4. Run `pnpm i`
5. Run `pnpm run build:etherpad`
6. Run `pnpm run prod`
7. Visit `http://localhost:9001` in your browser.

### Docker container

Find [here](doc/docker.adoc) information on running Etherpad in a container.

## Plugins

Etherpad is very customizable through plugins.

![Basic install](doc/public/etherpad_basic.png "Basic Installation")

![Full Features](doc/public/etherpad_full_features.png "You can add a lot of plugins !")

### Available Plugins

For a list of available plugins, see the [plugins
site](https://static.etherpad.org).

### Plugin Installation

You can install plugins from the admin web interface (e.g.,
http://127.0.0.1:9001/admin/plugins).

Alternatively, you can install plugins from the command line:

```sh
cd /path/to/etherpad-lite
pnpm run plugins i ep_${plugin_name}
```

Also see [the plugin wiki
article](https://github.com/ether/etherpad-lite/wiki/Available-Plugins).

### Suggested Plugins

Run the following command in your Etherpad folder to get all of the features
visible in the above demo gif:

```sh
pnpm run plugins i \
  ep_align \
  ep_comments_page \
  ep_embedded_hyperlinks2 \
  ep_font_color \
  ep_headings2 \
  ep_markdown \
  ep_webrtc
```

For user authentication, you are encouraged to run an [OpenID
Connect](https://openid.net/connect/) identity provider (OP) and install the
following plugins:

  * [ep_openid_connect](https://github.com/ether/ep_openid_connect#readme) to
    authenticate against your OP.
  * [ep_guest](https://github.com/ether/ep_guest#readme) to create a
    "guest" account that has limited access (e.g., read-only access).
  * [ep_user_displayname](https://github.com/ether/ep_user_displayname#readme)
    to automatically populate each user's displayed name from your OP.
  * [ep_stable_authorid](https://github.com/ether/ep_stable_authorid#readme) so
    that each user's chosen color, display name, comment ownership, etc. is
    strongly linked to their account.

### Upgrade Etherpad

Run the following command in your Etherpad folder to upgrade

1. Stop any running Etherpad (manual, systemd ...)
2. Get present version
```sh
git -P tag --contains
```
3. List versions available
```sh
git -P tag --list "v*" --merged
```
4. Select the version
```sh
git checkout v2.2.5
git switch -c v2.2.5
```
5. Upgrade Etherpad
```sh
./bin/run.sh
```
6. Stop with [CTRL-C]
7. Restart your Etherpad service

## Next Steps

### Tweak the settings

You can modify the settings in `settings.json`. If you need to handle multiple
settings files, you can pass the path to a settings file to `bin/run.sh`
using the `-s|--settings` option: this allows you to run multiple Etherpad
instances from the same installation. Similarly, `--credentials` can be used to
give a settings override file, `--apikey` to give a different APIKEY.txt file
and `--sessionkey` to give a non-default `SESSIONKEY.txt`. **Each configuration
parameter can also be set via an environment variable**, using the syntax
`"${ENV_VAR}"` or `"${ENV_VAR:default_value}"`. For details, refer to
`settings.json.template`. Once you have access to your `/admin` section,
settings can be modified through the web browser.

If you are planning to use Etherpad in a production environment, you should use
a dedicated database such as `mysql`, since the `dirtyDB` database driver is
only for testing and/or development purposes.

### Secure your installation

If you have enabled authentication in `users` section in `settings.json`, it is
a good security practice to **store hashes instead of plain text passwords** in
that file. This is _especially_ advised if you are running a production
installation.

Please install [ep_hash_auth plugin](https://www.npmjs.com/package/ep_hash_auth)
and configure it. If you prefer, `ep_hash_auth` also gives you the option of
storing the users in a custom directory in the file system, without having to
edit `settings.json` and restart Etherpad each time.

### Customize the style with skin variants

Open http://127.0.0.1:9001/p/test#skinvariantsbuilder in your browser and start
playing!

![Skin Variant](doc/public/etherpad_skin_variants.gif "Skin variants")

## Helpful resources

The [wiki](https://github.com/ether/etherpad-lite/wiki) is your one-stop
resource for Tutorials and How-to's.

Documentation can be found in `doc/`.

## Development

### Things you should know

You can debug Etherpad using `bin/debugRun.sh`.

You can run Etherpad quickly launching `bin/fastRun.sh`. It's convenient for
developers and advanced users. Be aware that it will skip the dependencies
update, so remember to run `bin/installDeps.sh` after installing a new
dependency or upgrading version.

If you want to find out how Etherpad's `Easysync` works (the library that makes
it really realtime), start with this
[PDF](https://github.com/ether/etherpad-lite/raw/master/doc/easysync/easysync-full-description.pdf)
(complex, but worth reading).

### Contributing

Read our [**Developer
Guidelines**](https://github.com/ether/etherpad-lite/blob/master/CONTRIBUTING.md)

### HTTP API

Etherpad is designed to be easily embeddable and provides a [HTTP
API](https://github.com/ether/etherpad-lite/wiki/HTTP-API) that allows your web
application to manage pads, users and groups. It is recommended to use the
[available client
implementations](https://github.com/ether/etherpad-lite/wiki/HTTP-API-client-libraries)
in order to interact with this API.

OpenAPI (previously swagger) definitions for the API are exposed under
`/api/openapi.json`.

### jQuery plugin

There is a [jQuery plugin](https://github.com/ether/etherpad-lite-jquery-plugin)
that helps you to embed Pads into your website.

### Plugin Framework

Etherpad offers a plugin framework, allowing you to easily add your own
features. By default your Etherpad is extremely light-weight and it's up to you
to customize your experience. Once you have Etherpad installed you should [visit
the plugin page](https://static.etherpad.org/) and take control.

### Translations / Localizations  (i18n / l10n)

Etherpad comes with translations into all languages thanks to the team at
[TranslateWiki](https://translatewiki.net/).

If you require translations in [plugins](https://static.etherpad.org/) please
send pull request to each plugin individually.

## FAQ

Visit the **[FAQ](https://github.com/ether/etherpad-lite/wiki/FAQ)**.

## Get in touch

The official channel for contacting the development team is via the [GitHub
issues](https://github.com/ether/etherpad-lite/issues).

For **responsible disclosure of vulnerabilities**, please write a mail to the
maintainers (a.mux@inwind.it and contact@etherpad.org).

Join the official [Etherpad Discord
Channel](https://discord.com/invite/daEjfhw).

## License

[Apache License v2](http://www.apache.org/licenses/LICENSE-2.0.html)
