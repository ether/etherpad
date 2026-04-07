#!/bin/sh
#
# Configure npm Trusted Publishers (OIDC) for ep_etherpad and every
# ether/ep_* plugin in bulk.
#
# Prerequisites:
#   - npm CLI >= 11.5.1 (the version that ships `npm trust github`)
#   - Logged into npmjs.com as a maintainer of the packages: `npm login`
#   - `gh` CLI logged in (only needed for plugin discovery; pass --packages
#     to skip discovery and use a static list)
#
# Usage:
#   bin/setup-trusted-publishers.sh                    # all ether/ep_* plugins + ep_etherpad
#   bin/setup-trusted-publishers.sh --dry-run          # print what would happen
#   bin/setup-trusted-publishers.sh --packages ep_align,ep_webrtc
#   bin/setup-trusted-publishers.sh --skip-existing    # don't fail if already configured
#   bin/setup-trusted-publishers.sh --otp 123456       # supply 2FA OTP up front
#
# Note: `npm trust github` requires 2FA. If your account has 2FA enabled
# (it should), pass --otp once and the same code will be reused for every
# package call inside the same minute. The TOTP code typically expires
# every 30s, so you may need to run the script in chunks via --packages.
#
# Each package gets a GitHub Actions trusted publisher pointing at the
# canonical workflow file used by that package family:
#   - plugins:    .github/workflows/test-and-release.yml
#   - ep_etherpad: .github/workflows/releaseEtherpad.yml
#
# Existing configurations cannot be overwritten — only one trust relationship
# per package is allowed today. Use `--skip-existing` to ignore those failures.

set -eu

# `npm trust github --file` wants ONLY the workflow filename (basename),
# not the full .github/workflows/<name> path.
PLUGIN_WORKFLOW="test-and-release.yml"
CORE_WORKFLOW="releaseEtherpad.yml"
CORE_PACKAGE="ep_etherpad"
CORE_REPO="etherpad-lite"
ORG="ether"

DRY_RUN=0
SKIP_EXISTING=0
PACKAGES=""
OTP=""

usage() {
  sed -n '2,/^$/p' "$0" | sed 's/^# \?//'
  exit "${1:-0}"
}

# ---------- arg parsing ----------
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run)        DRY_RUN=1;        shift ;;
    --skip-existing)  SKIP_EXISTING=1;  shift ;;
    --packages)       PACKAGES="$2";    shift 2 ;;
    --otp)            OTP="$2";         shift 2 ;;
    -h|--help)        usage 0 ;;
    *)                printf 'Unknown flag: %s\n' "$1" >&2; usage 1 ;;
  esac
done

# ---------- prereq checks ----------
is_cmd() { command -v "$1" >/dev/null 2>&1; }

is_cmd npm || { echo "npm CLI not found." >&2; exit 1; }

NPM_MAJOR=$(npm --version | cut -d. -f1)
NPM_MINOR=$(npm --version | cut -d. -f2)
NPM_PATCH=$(npm --version | cut -d. -f3)
if [ "$NPM_MAJOR" -lt 11 ] || \
   { [ "$NPM_MAJOR" -eq 11 ] && [ "$NPM_MINOR" -lt 5 ]; } || \
   { [ "$NPM_MAJOR" -eq 11 ] && [ "$NPM_MINOR" -eq 5 ] && [ "$NPM_PATCH" -lt 1 ]; }; then
  echo "npm >= 11.5.1 required (you have $(npm --version)). Run: npm install -g npm@latest" >&2
  exit 1
fi

# Verify auth (whoami fails if not logged in). Skipped in --dry-run.
if [ "$DRY_RUN" != "1" ]; then
  if ! npm whoami >/dev/null 2>&1; then
    echo "Not logged into npm. Run 'npm login' first." >&2
    exit 1
  fi
fi

# ---------- discover packages ----------
if [ -z "$PACKAGES" ]; then
  is_cmd gh || {
    echo "gh CLI not found. Either install it or pass --packages ep_a,ep_b,..." >&2
    exit 1
  }
  echo "Discovering ether/ep_* repos..."
  PACKAGES=$(gh repo list "$ORG" --limit 300 --json name,isArchived \
    --jq '.[] | select(.name | startswith("ep_")) | select(.isArchived | not) | .name' \
    | tr '\n' ',' | sed 's/,$//')
  PACKAGES="${CORE_PACKAGE},${PACKAGES}"
fi

# ---------- per-package setup ----------
configure_one() {
  PKG="$1"
  if [ "$PKG" = "$CORE_PACKAGE" ]; then
    REPO="$CORE_REPO"
    WORKFLOW="$CORE_WORKFLOW"
  else
    REPO="$PKG"
    WORKFLOW="$PLUGIN_WORKFLOW"
  fi

  printf '%-40s -> %s/%s @ %s\n' "$PKG" "$ORG" "$REPO" "$WORKFLOW"

  if [ "$DRY_RUN" = "1" ]; then
    printf '  (dry-run) would run: npm trust github %s --repository %s/%s --file %s --yes\n' \
      "$PKG" "$ORG" "$REPO" "$WORKFLOW"
    return 0
  fi

  if [ -n "$OTP" ]; then
    OUTPUT=$(npm trust github "$PKG" --repository "$ORG/$REPO" --file "$WORKFLOW" --otp "$OTP" --yes 2>&1)
  else
    OUTPUT=$(npm trust github "$PKG" --repository "$ORG/$REPO" --file "$WORKFLOW" --yes 2>&1)
  fi
  STATUS=$?
  if [ "$STATUS" -eq 0 ]; then
    printf '  ok\n'
  else
    # The npm registry returns 409 Conflict when a trust relationship
    # already exists (you can only have one per package today). Treat
    # that as success when --skip-existing is set, alongside the older
    # "already exists/configured" string match.
    if [ "$SKIP_EXISTING" = "1" ] && \
       echo "$OUTPUT" | grep -qiE "409 Conflict|already (exists|configured)"; then
      printf '  already configured (skipped)\n'
      return 0
    fi
    printf '  FAILED:\n%s\n' "$OUTPUT" | sed 's/^/    /'
    return 1
  fi
}

FAILED=""
TOTAL=0
OK=0
IFS=','
for PKG in $PACKAGES; do
  TOTAL=$((TOTAL + 1))
  if configure_one "$PKG"; then
    OK=$((OK + 1))
  else
    FAILED="$FAILED $PKG"
  fi
done
unset IFS

printf '\n%d/%d packages configured\n' "$OK" "$TOTAL"
if [ -n "$FAILED" ]; then
  printf 'Failed:%s\n' "$FAILED"
  exit 1
fi
