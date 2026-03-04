#!/bin/sh

# This script ensures that ep-lite is automatically restarting after
# an error happens

# Handling Errors
#   0 silent
#   1 email
ERROR_HANDLING=0
# Your email address which should receive the error messages
EMAIL_ADDRESS="no-reply@example.com"
# Sets the minimum amount of time between the sending of error emails.
# This ensures you do not get spammed during an endless reboot loop
# It's the time in seconds
TIME_BETWEEN_EMAILS=600 # 10 minutes

# DON'T EDIT AFTER THIS LINE

pecho() { printf %s\\n "$*"; }
log() { pecho "$@"; }
error() { log "ERROR: $@" >&2; }
fatal() { error "$@"; exit 1; }

LAST_EMAIL_SEND=0

# Move to the Etherpad base directory.
MY_DIR=$(cd "${0%/*}" && pwd -P) || exit 1
cd "${MY_DIR}/.." || exit 1

# Check if a logfile parameter is set
LOG="$1"
[ -n "${LOG}" ] || fatal "Set a logfile as the first parameter"
shift

while true; do
  # Try to touch the file if it doesn't exist
  [ -f "${LOG}" ] || touch "${LOG}" || fatal "Logfile '${LOG}' is not writeable"

  # Check if the file is writeable
  [ -w "${LOG}" ] || fatal "Logfile '${LOG}' is not writeable"

  # Start the application
  bin/run.sh "$@" >>${LOG} 2>>${LOG}

  TIME_FMT=$(date +%Y-%m-%dT%H:%M:%S%z)

  # Send email
  if [ "$ERROR_HANDLING" = 1 ]; then
    TIME_NOW=$(date +%s)
    TIME_SINCE_LAST_SEND=$(($TIME_NOW - $LAST_EMAIL_SEND))

    if [ "$TIME_SINCE_LAST_SEND" -gt "$TIME_BETWEEN_EMAILS" ]; then
      {
        cat <<EOF
Server was restarted at: ${TIME_FMT}
The last 50 lines of the log before the server exited:

EOF
        tail -n 50 "${LOG}"
      } | mail -s "Etherpad restarted" "$EMAIL_ADDRESS"

      LAST_EMAIL_SEND=$TIME_NOW
    fi
  fi

  pecho "RESTART! ${TIME_FMT}" >>${LOG}

  # Sleep 10 seconds before restart
  sleep 10
done
