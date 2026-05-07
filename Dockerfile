# Etherpad Dockerfile
#
# https://github.com/ether/etherpad
#
# Author: muxator
# Set to "copy" for builds without git metadata (source tarballs, some CI):
#   docker build --build-arg BUILD_ENV=copy .
ARG BUILD_ENV=git

ARG PnpmVersion=11.0.6

FROM node:26-alpine AS adminbuild
# Use corepack to provision pnpm and drop the bundled npm — its older
# transitives (picomatch, brace-expansion) carry CVEs we don't otherwise
# need. Refresh corepack first: the version bundled with Node 22 ships a
# stale signing-key list and rejects newer pnpm releases
# (nodejs/corepack#612). Mirrors the workaround in snap/snapcraft.yaml.
RUN npm install -g corepack@latest && \
    corepack enable && corepack prepare pnpm@${PnpmVersion} --activate && \
    rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
WORKDIR /opt/etherpad-lite
COPY . .
RUN pnpm install
RUN pnpm run build:ui


FROM node:26-alpine AS build
LABEL maintainer="Etherpad team, https://github.com/ether/etherpad"

# Set these arguments when building the image from behind a proxy
ARG http_proxy=
ARG https_proxy=
ARG no_proxy=

ARG TIMEZONE=

RUN \
  [ -z "${TIMEZONE}" ] || { \
    apk add --no-cache tzdata && \
    cp /usr/share/zoneinfo/${TIMEZONE} /etc/localtime && \
    echo "${TIMEZONE}" > /etc/timezone; \
  }
ENV TIMEZONE=${TIMEZONE}

# Control the configuration file to be copied into the container.
ARG SETTINGS=./settings.json.docker

# plugins to install while building the container. By default no plugins are
# installed.
# If given a value, it has to be a space-separated, quoted list of plugin names.
#
# EXAMPLE:
#   ETHERPAD_PLUGINS="ep_codepad ep_author_neat"
ARG ETHERPAD_PLUGINS=

# local plugins to install while building the container. By default no plugins are
# installed.
# If given a value, it has to be a space-separated, quoted list of plugin names.
#
# EXAMPLE:
#   ETHERPAD_LOCAL_PLUGINS="../ep_my_plugin ../ep_another_plugin"
ARG ETHERPAD_LOCAL_PLUGINS=

# github plugins to install while building the container. By default no plugins are
# installed.
# If given a value, it has to be a space-separated, quoted list of plugin names.
#
# EXAMPLE:
#   ETHERPAD_GITHUB_PLUGINS="ether/ep_plugin"
ARG ETHERPAD_GITHUB_PLUGINS=

# Control whether libreoffice will be installed, enabling exports to DOC/DOCX/PDF/ODT formats.
# By default, it is not installed.
# If given any value, libreoffice will be installed.
#
# EXAMPLE:
#   INSTALL_LIBREOFFICE=true
ARG INSTALL_SOFFICE=

# Install dependencies required for modifying access.
RUN apk add --no-cache shadow bash
# Follow the principle of least privilege: run as unprivileged user.
#
# Running as non-root enables running this image in platforms like OpenShift
# that do not allow images running as root.
#
# If any of the following args are set to the empty string, default
# values will be chosen.
ARG EP_HOME=
ARG EP_UID=5001
ARG EP_GID=0
ARG EP_SHELL=

RUN groupadd --system ${EP_GID:+--gid "${EP_GID}" --non-unique} etherpad && \
    useradd --system ${EP_UID:+--uid "${EP_UID}" --non-unique} --gid etherpad \
        ${EP_HOME:+--home-dir "${EP_HOME}"} --create-home \
        ${EP_SHELL:+--shell "${EP_SHELL}"} etherpad

ARG EP_DIR=/opt/etherpad-lite
RUN mkdir -p "${EP_DIR}" && chown etherpad:etherpad "${EP_DIR}"

# Share corepack's cache between root (which activates pnpm here) and
# the `etherpad` user (which invokes pnpm later via the corepack shim).
# $COREPACK_HOME defaults to ~/.cache/node/corepack and is per-user;
# without this pin the etherpad user finds an empty cache, re-resolves
# pnpm, and corepack can fall back to "latest" from the registry. See
# https://github.com/ether/etherpad/issues/7687.
ENV COREPACK_HOME=/opt/corepack

# the mkdir is needed for configuration of openjdk-11-jre-headless, see
# https://bugs.debian.org/cgi-bin/bugreport.cgi?bug=863199
RUN  \
    mkdir -p /usr/share/man/man1 "${COREPACK_HOME}" && \
    npm install -g corepack@latest && \
    corepack enable && corepack prepare pnpm@${PnpmVersion} --activate && \
    chown -R etherpad:etherpad "${COREPACK_HOME}" && \
    rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx && \
    apk update && apk upgrade && \
    apk add --no-cache \
        ca-certificates \
        git \
        ${INSTALL_SOFFICE:+libreoffice openjdk8-jre libreoffice-common} && \
    rm -rf /var/cache/apk/*

USER etherpad

WORKDIR "${EP_DIR}"

# etherpads version feature requires this. Only copy what is really needed
COPY --chown=etherpad:etherpad ${SETTINGS} ./settings.json
COPY --chown=etherpad:etherpad ./var ./var
COPY --chown=etherpad:etherpad ./bin ./bin
COPY --chown=etherpad:etherpad ./pnpm-workspace.yaml ./package.json ./



FROM build AS build_git
# When checked out as a git submodule, .git is a file (gitlink) instead of a
# directory, so .git/HEAD and .git/refs do not exist.  Copy the whole .git
# entry (the .dockerignore already strips the heavy objects) and normalise it
# with a shell step so the build succeeds in both cases and across builders
# (Docker, buildah, podman).  See #6663 and containers/buildah#5742.
ONBUILD COPY --chown=etherpad:etherpad ./.git ./.git
ONBUILD RUN if [ -f .git ]; then rm .git; fi

FROM build AS build_copy




FROM build_${BUILD_ENV} AS development

ARG ETHERPAD_PLUGINS=
ARG ETHERPAD_LOCAL_PLUGINS=
ARG ETHERPAD_LOCAL_PLUGINS_ENV=
ARG ETHERPAD_GITHUB_PLUGINS=

COPY --chown=etherpad:etherpad ./src/ ./src/
COPY --chown=etherpad:etherpad --from=adminbuild /opt/etherpad-lite/src/templates/admin ./src/templates/admin
COPY --chown=etherpad:etherpad --from=adminbuild /opt/etherpad-lite/src/static/oidc ./src/static/oidc

COPY --chown=etherpad:etherpad ./local_plugin[s] ./local_plugins/

RUN bash -c ./bin/installLocalPlugins.sh

RUN bin/installDeps.sh && \
  if [ ! -z "${ETHERPAD_PLUGINS}" ] || [ ! -z "${ETHERPAD_GITHUB_PLUGINS}" ]; then \
      pnpm run plugins i ${ETHERPAD_PLUGINS} ${ETHERPAD_GITHUB_PLUGINS:+--github ${ETHERPAD_GITHUB_PLUGINS}}; \
  fi


FROM build_${BUILD_ENV} AS production

ARG ETHERPAD_PLUGINS=
ARG ETHERPAD_LOCAL_PLUGINS=
ARG ETHERPAD_LOCAL_PLUGINS_ENV=
ARG ETHERPAD_GITHUB_PLUGINS=

ENV NODE_ENV=production
ENV ETHERPAD_PRODUCTION=true

# The full pnpm-workspace.yaml references admin, doc, ui which are not
# needed at runtime. Overwrite it with a production-only version so
# pnpm install doesn't warn about missing workspace directories.
# Preserve the build-script policy from the source workspace file so
# pnpm 11 doesn't error out with ERR_PNPM_IGNORED_BUILDS for transitive
# postinstalls (e.g. @scarf/scarf via swagger-ui-dist).
RUN printf 'packages:\n  - src\n  - bin\nonlyBuiltDependencies:\n  - esbuild\nignoredBuiltDependencies:\n  - "@scarf/scarf"\nstrictDepBuilds: false\n' > pnpm-workspace.yaml

COPY --chown=etherpad:etherpad ./src ./src
COPY --chown=etherpad:etherpad --from=adminbuild /opt/etherpad-lite/src/templates/admin ./src/templates/admin
COPY --chown=etherpad:etherpad --from=adminbuild /opt/etherpad-lite/src/static/oidc ./src/static/oidc

COPY --chown=etherpad:etherpad ./local_plugin[s] ./local_plugins/

RUN bash -c ./bin/installLocalPlugins.sh

RUN bin/installDeps.sh && \
  if [ ! -z "${ETHERPAD_PLUGINS}" ] || [ ! -z "${ETHERPAD_GITHUB_PLUGINS}" ]; then \
      pnpm run plugins i ${ETHERPAD_PLUGINS} ${ETHERPAD_GITHUB_PLUGINS:+--github ${ETHERPAD_GITHUB_PLUGINS}}; \
  fi && \
    pnpm store prune

# Copy the configuration file.
COPY --chown=etherpad:etherpad ${SETTINGS} "${EP_DIR}"/settings.json

# Fix group permissions
# Note: For some reason increases image size from 257 to 334.
# RUN chmod -R g=u .

USER etherpad

HEALTHCHECK --interval=5s --timeout=3s \
  CMD wget -qO- http://127.0.0.1:9001/health | grep -E "pass|ok|up" > /dev/null || exit 1

EXPOSE 9001
CMD ["pnpm", "run", "prod"]
