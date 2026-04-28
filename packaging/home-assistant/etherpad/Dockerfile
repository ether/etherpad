ARG BUILD_FROM=ghcr.io/home-assistant/amd64-base:3.19
ARG ETHERPAD_VERSION=2.6.1

# ---------------------------------------------------------------------------
# Stage 1: grab the pre-built Etherpad tree from the official image.
# Both the upstream image and the HA base use Alpine, so /opt/etherpad-lite
# copies across cleanly without reinstalling deps.
# ---------------------------------------------------------------------------
FROM etherpad/etherpad:${ETHERPAD_VERSION} AS upstream

# ---------------------------------------------------------------------------
# Stage 2: assemble the add-on on top of the HA base (Alpine + s6-overlay v3).
# ---------------------------------------------------------------------------
FROM ${BUILD_FROM}

ARG ETHERPAD_VERSION
ENV ETHERPAD_VERSION=${ETHERPAD_VERSION} \
    NODE_ENV=production \
    ETHERPAD_PRODUCTION=true \
    EP_DIR=/opt/etherpad-lite

RUN apk add --no-cache \
      bash \
      ca-certificates \
      curl \
      nodejs \
      npm \
      tini \
    && rm -rf /var/cache/apk/*

COPY --from=upstream /opt/etherpad-lite /opt/etherpad-lite

# Upstream uses pnpm as the runtime launcher for `pnpm run prod`.
RUN npm install -g pnpm@10.33.0

COPY rootfs/ /

EXPOSE 9001

ARG BUILD_ARCH
ARG BUILD_DATE
ARG BUILD_DESCRIPTION
ARG BUILD_NAME
ARG BUILD_REF
ARG BUILD_REPOSITORY
ARG BUILD_VERSION
LABEL \
    io.hass.name="${BUILD_NAME}" \
    io.hass.description="${BUILD_DESCRIPTION}" \
    io.hass.arch="${BUILD_ARCH}" \
    io.hass.type="addon" \
    io.hass.version=${BUILD_VERSION} \
    maintainer="Etherpad Foundation <contact@etherpad.org>" \
    org.opencontainers.image.title="${BUILD_NAME}" \
    org.opencontainers.image.description="${BUILD_DESCRIPTION}" \
    org.opencontainers.image.vendor="Etherpad" \
    org.opencontainers.image.authors="Etherpad Foundation" \
    org.opencontainers.image.licenses="Apache-2.0" \
    org.opencontainers.image.url="https://etherpad.org" \
    org.opencontainers.image.source="https://github.com/ether/etherpad-lite" \
    org.opencontainers.image.documentation="https://etherpad.org/doc" \
    org.opencontainers.image.created=${BUILD_DATE} \
    org.opencontainers.image.revision=${BUILD_REF} \
    org.opencontainers.image.version=${BUILD_VERSION}
