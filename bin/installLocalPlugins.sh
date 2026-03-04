#!/bin/bash
set -euo pipefail
IFS=$'\n\t'

trim() {
    local var="$*"
    # remove leading whitespace characters
    var="${var#"${var%%[![:space:]]*}"}"
    # remove trailing whitespace characters
    var="${var%"${var##*[![:space:]]}"}"
    printf '%s' "$var"
}

# Move to the Etherpad base directory.
MY_DIR=$(cd "${0%/*}" && pwd -P) || exit 1
cd "${MY_DIR}/.." || exit 1

# Source constants and useful functions
. bin/functions.sh

PNPM_OPTIONS=
if [ ! -z "${NODE_ENV-}"  ]; then
  if [ "$NODE_ENV" == 'production' ]; then
    PNPM_OPTIONS='--prod'
  fi
fi

if [ ! -z "${ETHERPAD_LOCAL_PLUGINS_ENV-}"  ]; then
  if [ "$ETHERPAD_LOCAL_PLUGINS_ENV" == 'production' ]; then
    PNPM_OPTIONS='--prod'
  elif [ "$ETHERPAD_LOCAL_PLUGINS_ENV" == 'development' ]; then
    PNPM_OPTIONS='-D'
  fi
fi

if [ ! -z "${ETHERPAD_LOCAL_PLUGINS}" ]; then
  readarray -d ' ' plugins <<< "${ETHERPAD_LOCAL_PLUGINS}"
  for plugin in "${plugins[@]}"; do
    plugin=$(trim "$plugin")
    if [ -d "local_plugins/${plugin}" ]; then
      echo "Installing plugin: '${plugin}'"
      pnpm install -w ${PNPM_OPTIONS:-} "local_plugins/${plugin}/"
    else
      ( echo "Error. Directory 'local_plugins/${plugin}' for local plugin " \
             "'${plugin}' missing" >&2 )
      exit 1
    fi
  done
else
  echo 'No local plugings to install.'
fi
