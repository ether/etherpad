#!/bin/sh
# postremove - runs after files are removed.
# Debian actions: remove | purge | upgrade | failed-upgrade | abort-install |
#                 abort-upgrade | disappear
set -e

APP_DIR=/opt/etherpad

case "$1" in
  remove)
    [ -L "${APP_DIR}/settings.json" ] && rm -f "${APP_DIR}/settings.json" || true
    [ -L "${APP_DIR}/var" ] && rm -f "${APP_DIR}/var" || true
    [ -L "${APP_DIR}/src/plugin_packages" ] && rm -f "${APP_DIR}/src/plugin_packages" || true
    if [ -d /run/systemd/system ] && command -v systemctl >/dev/null 2>&1; then
      # Disable so the wants/ symlink doesn't dangle after the unit
      # file is removed by dpkg.
      systemctl disable etherpad.service >/dev/null 2>&1 || true
      systemctl daemon-reload || true
    fi
    ;;

  purge)
    # Runtime-created plugin artifacts that dpkg did not ship and so
    # will not have cleaned up: the .versions/ stage that
    # live-plugin-manager populates inside plugin_packages, and the
    # corresponding ep_* symlinks in node_modules. After this PR
    # plugin_packages lives in-tree under ${APP_DIR}/src/, so a stale
    # purge would otherwise leave admin-installed plugins behind.
    # See ether/ep_comments_page#416.
    rm -rf "${APP_DIR}/src/plugin_packages"
    if [ -d "${APP_DIR}/src/node_modules" ]; then
      find "${APP_DIR}/src/node_modules" -maxdepth 1 -name 'ep_*' \
        -exec rm -rf {} +
    fi
    # Belt-and-braces: anything else dpkg didn't manage inside the
    # application tree gets cleaned up on purge too.
    rm -rf "${APP_DIR}"

    rm -rf /etc/etherpad
    rm -rf /var/lib/etherpad
    rm -rf /var/log/etherpad

    if getent passwd etherpad >/dev/null 2>&1; then
      deluser --system etherpad >/dev/null 2>&1 || true
    fi
    if getent group etherpad >/dev/null 2>&1; then
      delgroup --system etherpad >/dev/null 2>&1 || true
    fi

    if [ -d /run/systemd/system ] && command -v systemctl >/dev/null 2>&1; then
      systemctl daemon-reload || true
    fi
    ;;

  upgrade|failed-upgrade|abort-install|abort-upgrade|disappear)
    ;;

  *)
    echo "postremove called with unknown argument: $1" >&2
    exit 1
    ;;
esac

exit 0
