#!/bin/sh
# postremove - runs after files are removed.
# Debian actions: remove | purge | upgrade | failed-upgrade | abort-install |
#                 abort-upgrade | disappear
set -e

APP_DIR=/opt/etherpad-lite

case "$1" in
  remove)
    [ -L "${APP_DIR}/settings.json" ] && rm -f "${APP_DIR}/settings.json" || true
    if [ -d /run/systemd/system ] && command -v systemctl >/dev/null 2>&1; then
      systemctl daemon-reload || true
    fi
    ;;

  purge)
    rm -rf /etc/etherpad-lite
    rm -rf /var/lib/etherpad-lite
    rm -rf /var/log/etherpad-lite

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
