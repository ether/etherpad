#!/bin/bash
#
# Run Etherpad directly, assuming all the dependencies are already installed.
#
# Useful for developers, or users that know what they are doing. If you just
# upgraded Etherpad version, installed a new dependency, or are simply unsure
# of what to do, please execute bin/installDeps.sh once before running this
# script.

set -eu

# Move to the Etherpad base directory.
MY_DIR=$(cd "${0%/*}" && pwd -P) || exit 1
cd "${MY_DIR}/.." || exit 1

# Source constants and useful functions
. bin/functions.sh

echo "Running directly, without checking/installing dependencies"

# run Etherpad main class
exec pnpm run prod "$@"
