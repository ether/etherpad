#!/bin/sh
set -e
mydir=$(cd "${0%/*}" && pwd -P) || exit 1
cd "${mydir}"/..
exec pnpm --filter bin run plugins update
