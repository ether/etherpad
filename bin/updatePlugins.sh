#!/bin/sh
set -e
mydir=$(cd "${0%/*}" && pwd -P) || exit 1
cd "${mydir}"/..
OUTDATED=$(npm outdated --depth=0 | awk '{print $1}' | grep '^ep_') || {
  echo "All plugins are up-to-date"
  exit 0
}
set -- ${OUTDATED}
echo "Updating plugins: $*"
exec pnpm install "$@"
