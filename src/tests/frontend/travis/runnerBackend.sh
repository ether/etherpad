#!/bin/sh

pecho() { printf %s\\n "$*"; }
log() { pecho "$@"; }
error() { log "ERROR: $@" >&2; }
fatal() { error "$@"; exit 1; }
try() { "$@" || fatal "'$@' failed"; }

# Move to the Etherpad base directory.
MY_DIR=$(try cd "${0%/*}" && try pwd -P) || exit 1
try cd "${MY_DIR}/../../../.."

try sed -e '
s!"soffice":[^,]*!"soffice": "/usr/bin/soffice"!
# Reduce rate limit aggressiveness
s!"max":[^,]*!"max": 100!
s!"points":[^,]*!"points": 1000!
' settings.json.template >settings.json

log "Deprecation notice: runnerBackend.sh - Please use: cd src && npm test"
log "Assuming src/bin/installDeps.sh has already been run"
(cd src && npm run dev "${@}" &
ep_pid=$!)

log "Waiting for Etherpad to accept connections (http://localhost:9001)..."
connected=false
can_connect() {
    curl -sSfo /dev/null http://localhost:9001/ || return 1
    connected=true
}
now() { date +%s; }
start=$(now)
while [ $(($(now) - $start)) -le 15 ] && ! can_connect; do
    sleep 1
done
[ "$connected" = true ] \
    || fatal "Timed out waiting for Etherpad to accept connections"
log "Successfully connected to Etherpad on http://localhost:9001"

log "Running the backend tests..."
try cd src
npm test
exit_code=$?

kill "$ep_pid" && wait "$ep_pid"
log "Done."
exit "$exit_code"
