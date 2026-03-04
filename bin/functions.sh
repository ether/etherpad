# minimum required node version
REQUIRED_NODE_MAJOR=12
REQUIRED_NODE_MINOR=13

# minimum required npm version
REQUIRED_NPM_MAJOR=5
REQUIRED_NPM_MINOR=5

pecho() { printf %s\\n "$*"; }
log() { pecho "$@"; }
error() { log "ERROR: $@" >&2; }
fatal() { error "$@"; exit 1; }
is_cmd() { command -v "$@" >/dev/null 2>&1; }


get_program_version() {
  PROGRAM="$1"
  KIND="${2:-full}"
  PROGRAM_VERSION_STRING=$($PROGRAM --version)
  PROGRAM_VERSION_STRING=${PROGRAM_VERSION_STRING#"v"}

  DETECTED_MAJOR=$(pecho "$PROGRAM_VERSION_STRING" | cut -s -d "." -f 1)
  [ -n "$DETECTED_MAJOR" ] || fatal "Cannot extract $PROGRAM major version from version string \"$PROGRAM_VERSION_STRING\""
  case "$DETECTED_MAJOR" in
      ''|*[!0-9]*)
        fatal "$PROGRAM_LABEL major version from \"$VERSION_STRING\" is not a number. Detected: \"$DETECTED_MAJOR\""
        ;;
  esac

  DETECTED_MINOR=$(pecho "$PROGRAM_VERSION_STRING" | cut -s -d "." -f 2)
  [ -n "$DETECTED_MINOR" ] || fatal "Cannot extract $PROGRAM minor version from version string \"$PROGRAM_VERSION_STRING\""
  case "$DETECTED_MINOR" in
      ''|*[!0-9]*)
        fatal "$PROGRAM_LABEL minor version from \"$VERSION_STRING\" is not a number. Detected: \"$DETECTED_MINOR\""
  esac

  case $KIND in
    major)
      echo $DETECTED_MAJOR
      exit;;
    minor)
      echo $DETECTED_MINOR
      exit;;
    *)
      echo $DETECTED_MAJOR.$DETECTED_MINOR
      exit;;
  esac

  echo $VERSION
}


require_minimal_version() {
  PROGRAM_LABEL="$1"
  VERSION="$2"
  REQUIRED_MAJOR="$3"
  REQUIRED_MINOR="$4"

  VERSION_MAJOR=$(pecho "$VERSION" | cut -s -d "." -f 1)
  VERSION_MINOR=$(pecho "$VERSION" | cut -s -d "." -f 2)

  [ "$VERSION_MAJOR" -gt "$REQUIRED_MAJOR" ] || ([ "$VERSION_MAJOR" -eq "$REQUIRED_MAJOR" ] && [ "$VERSION_MINOR" -ge "$REQUIRED_MINOR" ]) \
    || fatal "Your $PROGRAM_LABEL version \"$VERSION_MAJOR.$VERSION_MINOR\" is too old. $PROGRAM_LABEL $REQUIRED_MAJOR.$REQUIRED_MINOR.x or higher is required."
}
