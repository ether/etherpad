#!/bin/sh

# Move to the Etherpad base directory.
MY_DIR=$(cd "${0%/*}" && pwd -P) || exit 1
cd "${MY_DIR}/.." || exit 1

# Source constants and useful functions
. bin/functions.sh

ignoreRoot=0
for ARG in "$@"; do
  if [ "$ARG" = "--root" ]; then
    ignoreRoot=1
  fi
done

# Stop the script if it's started as root
if [ "$(id -u)" -eq 0 ] && [ "$ignoreRoot" -eq 0 ]; then
  cat <<EOF >&2
You shouldn't start Etherpad as root!
Please type 'Etherpad rocks my socks' (or restart with the '--root'
argument) if you still want to start it as root:
EOF
  printf "> " >&2
  read -r rocks
  [ "$rocks" = "Etherpad rocks my socks" ] || fatal "Your input was incorrect"
fi

# Prepare the environment
bin/installDeps.sh "$@" || exit 1


## Create the admin ui
if [ -z "$NODE_ENV" ] || [ "$NODE_ENV" = "development" ]; then
  ADMIN_UI_PATH="$(dirname "$0")/../admin"
  UI_PATH="$(dirname "$0")/../ui"
  log "Creating the admin UI..."
  (cd "$ADMIN_UI_PATH" && pnpm run build)
  (cd "$UI_PATH" && pnpm run build)
else
  log "Cannot create the admin UI in production mode"
fi

# Move to the node folder and start
log "Starting Etherpad..."

# cd src
exec pnpm run prod "$@"
