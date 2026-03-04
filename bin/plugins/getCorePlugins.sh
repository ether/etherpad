#!/bin/sh

set -e

newline='
'

pecho () { printf %s\\n "$*"; }
log () { pecho "$@"; }
error () { log "ERROR: $@" >&2; }
fatal () { error "$@"; exit 1; }

mydir=$(cd "${0%/*}" && pwd -P) || exit 1
cd "${mydir}/../.."
pdir=$(cd .. && pwd -P) || exit 1

plugins=$("${mydir}/listOfficialPlugins") || exit 1
echo $plugins
for d in ${plugins}; do
  echo $d
  log "============================================================"
  log "${d}"
  log "============================================================"
  fd=${pdir}/${d}
  repo=https://github.com/ether/${d}.git
  [ -d "${fd}" ] || {
    log "Cloning ${repo} to ${fd}..."
    (cd "${pdir}" && git clone "${repo}" "${d}") || continue
  } || exit 1
  log "Fetching latest commits..."
  (cd "${fd}" && git pull --ff-only) || exit 1
  #log "Getting plugin name..."
  #pn=$(cd "${fd}" && npx -c 'printf %s\\n "${npm_package_name}"') || exit 1
  #[ -n "${pn}" ] || fatal "Unable to determine plugin name for ${d}"
  #md=node_modules/${pn}
  #[ -d "${md}" ] || {
  #  log "Installing plugin to ${md}..."
  #  ln -s ../../"${d}" "${md}"
  #} || exit 1
  #[ "${md}" -ef "${fd}" ] || fatal "${md} is not a symlink to ${fd}"
done
