#!/bin/sh

# Move to the Etherpad base directory.
MY_DIR=$(cd "${0%/*}" && pwd -P) || exit 1
cd "${MY_DIR}/.." || exit 1

# Source constants and useful functions
. bin/functions.sh

# Prepare the environment
bin/installDeps.sh || exit 1

echo "If you are new to debugging Node.js with Chrome DevTools, take a look at this page:"
echo "https://medium.com/@paul_irish/debugging-node-js-nightlies-with-chrome-devtools-7c4a1b95ae27"
echo "Open 'chrome://inspect' on Chrome to start debugging."

cd src
# Use 0.0.0.0 to allow external connections to the debugger
# (ex: running Etherpad on a docker container). Use default port # (9229)
exec node --import tsx --inspect=0.0.0.0:9229 ./node/server.ts "$@"
