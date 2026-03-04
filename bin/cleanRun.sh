#!/bin/sh

# Move to the Etherpad base directory.
MY_DIR=$(cd "${0%/*}" && pwd -P) || exit 1
cd "${MY_DIR}/.." || exit 1

# Source constants and useful functions
. bin/functions.sh

ignoreRoot=0
for ARG in "$@"
do
  if [ "$ARG" = "--root" ]; then
    ignoreRoot=1
  fi
done

#Stop the script if it's started as root
if [ "$(id -u)" -eq 0 ] && [ $ignoreRoot -eq 0 ]; then
   echo "You shouldn't start Etherpad as root!"
   echo "Please type 'Etherpad rocks my socks' or supply the '--root' argument if you still want to start it as root"
   read rocks
   if [ ! $rocks = "Etherpad rocks my socks" ]
   then
     echo "Your input was incorrect"
     exit 1
   fi
fi

#Clean the current environment
rm -rf src/node_modules

#Prepare the environment
bin/installDeps.sh "$@" || exit 1

#Move to the node folder and start
echo "Starting Etherpad..."
cd src
exec node --import tsx ./node/server.ts "$@"
