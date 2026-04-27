#!/bin/sh
# postinstall - runs after files have been unpacked.
# Debian actions: configure | abort-upgrade | abort-remove | abort-deconfigure
set -e

ETC_DIR=/etc/etherpad
VAR_DIR=/var/lib/etherpad
LOG_DIR=/var/log/etherpad
APP_DIR=/opt/etherpad
RUNTIME_VAR="${VAR_DIR}/var"
DIST_SETTINGS=/usr/share/etherpad/settings.json.dist
ACTIVE_SETTINGS="${ETC_DIR}/settings.json"
INSTALLED_PLUGINS="${RUNTIME_VAR}/installed_plugins.json"

case "$1" in
  configure)
    mkdir -p "${ETC_DIR}" "${VAR_DIR}" "${LOG_DIR}" "${RUNTIME_VAR}"
    chown root:etherpad "${ETC_DIR}"
    chmod 0750 "${ETC_DIR}"
    chown etherpad:etherpad "${VAR_DIR}" "${LOG_DIR}" "${RUNTIME_VAR}"
    chmod 0750 "${VAR_DIR}" "${LOG_DIR}" "${RUNTIME_VAR}"

    if [ ! -e "${ACTIVE_SETTINGS}" ]; then
      cp "${DIST_SETTINGS}" "${ACTIVE_SETTINGS}"
      # Switch the shipped default from dirty (dev-only, per the template's
      # own comment) to sqlite, and point the file at /var/lib/etherpad so
      # ProtectSystem=strict doesn't block writes.
      sed -i \
        -e 's|"dbType": "dirty"|"dbType": "sqlite"|' \
        -e 's|"filename": "var/dirty.db"|"filename": "/var/lib/etherpad/etherpad.db"|' \
        "${ACTIVE_SETTINGS}"
      chown root:etherpad "${ACTIVE_SETTINGS}"
      chmod 0640 "${ACTIVE_SETTINGS}"
    fi

    # Etherpad reads settings.json from CWD (/opt/etherpad). Expose
    # the /etc copy there via symlink.
    ln -sfn "${ACTIVE_SETTINGS}" "${APP_DIR}/settings.json"

    # Redirect /opt/etherpad/var to a writable location under
    # /var/lib/etherpad. Etherpad writes var/js, var/installed_plugins.json,
    # etc. on startup; ProtectSystem=strict blocks /opt writes, and the
    # symlink keeps ReadWritePaths=/var/lib/etherpad sufficient.
    if [ -e "${APP_DIR}/var" ] && [ ! -L "${APP_DIR}/var" ]; then
      # Migrate any payload from a previous install that wrote into /opt.
      cp -a "${APP_DIR}/var/." "${RUNTIME_VAR}/" 2>/dev/null || true
      rm -rf "${APP_DIR}/var"
    fi
    ln -sfn "${RUNTIME_VAR}" "${APP_DIR}/var"

    # Seed installed_plugins.json so checkForMigration() does not spawn
    # `pnpm ls` on first boot. pnpm is not a package dependency, and the
    # bundled node_modules already contains every shipped plugin.
    if [ ! -e "${INSTALLED_PLUGINS}" ]; then
      VERSION=$(node -p "require('${APP_DIR}/src/package.json').version" 2>/dev/null \
                || node -p "require('${APP_DIR}/package.json').version" 2>/dev/null \
                || echo "0.0.0")
      cat >"${INSTALLED_PLUGINS}" <<EOF
{"plugins":[{"name":"ep_etherpad-lite","version":"${VERSION}"}]}
EOF
    fi

    chown -R etherpad:etherpad "${RUNTIME_VAR}"

    if [ -d /run/systemd/system ] && command -v systemctl >/dev/null 2>&1; then
      systemctl daemon-reload || true
      # Enable on first install; leave state alone on upgrade.
      if [ -z "$2" ]; then
        systemctl enable etherpad.service >/dev/null 2>&1 || true
      fi
      # Restart on upgrade to pick up new code (skip on fresh install --
      # admin may want to configure first).
      if [ -n "$2" ]; then
        systemctl try-restart etherpad.service >/dev/null 2>&1 || true
      fi
    fi

    cat <<EOF
Etherpad installed. Edit /etc/etherpad/settings.json, then:
  sudo systemctl start etherpad
Default port 9001. Service logs: journalctl -u etherpad -f
EOF
    ;;

  abort-upgrade|abort-remove|abort-deconfigure)
    ;;

  *)
    echo "postinstall called with unknown argument: $1" >&2
    exit 1
    ;;
esac

exit 0
