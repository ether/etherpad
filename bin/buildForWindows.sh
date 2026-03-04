#!/bin/sh

set -e

pecho() { printf %s\\n "$*"; }
log() { pecho "$@"; }
error() { log "ERROR: $@" >&2; }
fatal() { error "$@"; exit 1; }
try() { "$@" || fatal "'$@' failed"; }
is_cmd() { command -v "$@" >/dev/null 2>&1; }

for x in git unzip wget zip; do
  is_cmd "${x}" || fatal "Please install ${x}"
done

# Move to the folder where Etherpad is checked out
try cd "${0%/*}"
workdir=$(try git rev-parse --show-toplevel) || exit 1
try cd "${workdir}"
[ -f src/package.json ] || fatal "failed to cd to etherpad root directory"

# See https://github.com/msys2/MSYS2-packages/issues/1216
export MSYSTEM=winsymlinks:lnk

OUTPUT=${workdir}/etherpad-win.zip

TMP_FOLDER=$(try mktemp -d) || exit 1
trap 'exit 1' HUP INT TERM
trap 'log "cleaning up..."; try cd / && try rm -rf "${TMP_FOLDER}"' EXIT

log "create a clean environment in $TMP_FOLDER..."
try export GIT_WORK_TREE=${TMP_FOLDER}; git checkout HEAD -f \
    || fatal "failed to copy etherpad to temporary folder"
try mkdir "${TMP_FOLDER}"/.git
try git rev-parse HEAD >${TMP_FOLDER}/.git/HEAD
# Disable symlinks to avoid problems with Windows
#try pnpm i "${TMP_FOLDER}"/src/node_modules

try cd "${TMP_FOLDER}"
[ -f src/package.json ] || fatal "failed to copy etherpad to temporary folder"

# setting NODE_ENV=production ensures that dev dependencies are not installed,
# making the windows package smaller
export NODE_ENV=development

rm -rf node_modules || true
rm -rf src/node_modules || true

#log "do a normal unix install first..."
#$(try cd ./bin/installDeps.sh)

# Install admin frontend
try pnpm install
try pnpm run build:etherpad

# Nuke the admin folder as it is not needed anymore :D
rm -rf admin
rm -rf oidc
rm -rf src/node_modules

log "copy the windows settings template..."
try cp settings.json.template settings.json

#log "resolve symbolic links..."
#try cp -rL node_modules node_modules_resolved
#try rm -rf node_modules
#try mv node_modules_resolved node_modules

log "download windows node..."
try wget "https://nodejs.org/dist/latest-v20.x/win-x64/node.exe" -O node.exe

log "create the zip..."
try zip -9 -r "${OUTPUT}" ./*

log "Finished. You can find the zip at ${OUTPUT}"
