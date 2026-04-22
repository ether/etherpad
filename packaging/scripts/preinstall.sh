#!/bin/sh
# preinstall - runs before files are unpacked.
# Debian actions: install | upgrade | abort-upgrade
set -e

case "$1" in
  install|upgrade)
    if ! getent group etherpad >/dev/null 2>&1; then
      addgroup --system etherpad
    fi
    if ! getent passwd etherpad >/dev/null 2>&1; then
      adduser --system --ingroup etherpad \
              --home /var/lib/etherpad-lite \
              --no-create-home \
              --shell /usr/sbin/nologin \
              --gecos "Etherpad service user" \
              etherpad
    fi
    ;;
  abort-upgrade)
    ;;
  *)
    echo "preinstall called with unknown argument: $1" >&2
    exit 1
    ;;
esac

exit 0
