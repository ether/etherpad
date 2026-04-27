#!/bin/sh
# preremove - runs before files are removed.
# Debian actions: remove | upgrade | deconfigure | failed-upgrade
set -e

case "$1" in
  remove|upgrade|deconfigure)
    if [ -d /run/systemd/system ] && command -v systemctl >/dev/null 2>&1; then
      systemctl stop etherpad.service >/dev/null 2>&1 || true
    fi
    ;;
  failed-upgrade)
    ;;
  *)
    echo "preremove called with unknown argument: $1" >&2
    exit 1
    ;;
esac

exit 0
