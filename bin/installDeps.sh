#!/bin/sh


# Move to the Etherpad base directory.
MY_DIR=$(cd "${0%/*}" && pwd -P) || exit 1
cd "${MY_DIR}/.." || exit 1

# Source constants and useful functions
. bin/functions.sh

is_cmd pnpm || npm install pnpm -g


# Is node installed?
# Not checking io.js, default installation creates a symbolic link to node
is_cmd node || fatal "Please install node.js ( https://nodejs.org )"

# Check node version
require_minimal_version "nodejs" "$(get_program_version "node")" \
    "$REQUIRED_NODE_MAJOR" "$REQUIRED_NODE_MINOR"

# Get the name of the settings file
settings="settings.json"
a='';
for arg in "$@"; do
  if [ "$a" = "--settings" ] || [ "$a" = "-s" ]; then settings=$arg; fi
  a=$arg
done

# Does a $settings exist? if not copy the template
if [ ! -f "$settings" ]; then
  log "Copy the settings template to $settings..."
  cp settings.json.template "$settings" || exit 1
fi

log "Installing dependencies..."
if [ -z "${ETHERPAD_PRODUCTION}" ]; then
  log "Installing dev dependencies with pnpm"
  pnpm --recursive i  || exit 1
else
  log "Installing production dependencies with pnpm"
  pnpm --recursive i --production || exit 1
fi

# Remove all minified data to force node creating it new
log "Clearing minified cache..."
rm -f var/minified*

exit 0
