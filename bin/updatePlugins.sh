#!/bin/sh
set -e
mydir=$(cd "${0%/*}" && pwd -P) || exit 1
cd "${mydir}"/..
outdated_raw=$(pnpm --filter ep_etherpad-lite outdated --depth=0 2>&1) || true
OUTDATED=$(printf '%s\n' "$outdated_raw" | awk '{print $1}' | grep '^ep_' | grep -v '^ep_etherpad-lite$') || true
if [ -z "$OUTDATED" ]; then
  echo "All plugins are up-to-date"
  exit 0
fi
set -- ${OUTDATED}
echo "Updating plugins: $*"
exec pnpm --filter ep_etherpad-lite update "$@"
