#!/bin/sh
#
# Etherpad one-line installer.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/ether/etherpad-lite/master/bin/installer.sh | sh
#
# Optional environment variables:
#   ETHERPAD_DIR     Directory to install into (default: ./etherpad-lite)
#   ETHERPAD_BRANCH  Branch / tag to clone (default: master)
#   ETHERPAD_RUN     If set to 1, start Etherpad after install
#   NO_COLOR         If set, disables coloured output

set -eu

# ---------- pretty output ----------
if [ -z "${NO_COLOR:-}" ] && [ -t 1 ]; then
  bold=$(printf '\033[1m')
  green=$(printf '\033[32m')
  red=$(printf '\033[31m')
  yellow=$(printf '\033[33m')
  reset=$(printf '\033[0m')
else
  bold=''; green=''; red=''; yellow=''; reset=''
fi

step()  { printf '%s==>%s %s%s%s\n' "$green" "$reset" "$bold" "$*" "$reset"; }
warn()  { printf '%s==>%s %s\n' "$yellow" "$reset" "$*" >&2; }
fatal() { printf '%s==>%s %s\n' "$red" "$reset" "$*" >&2; exit 1; }

is_cmd() { command -v "$1" >/dev/null 2>&1; }

# ---------- defaults ----------
ETHERPAD_DIR="${ETHERPAD_DIR:-etherpad-lite}"
ETHERPAD_BRANCH="${ETHERPAD_BRANCH:-master}"
ETHERPAD_REPO="${ETHERPAD_REPO:-https://github.com/ether/etherpad-lite.git}"
REQUIRED_NODE_MAJOR=20

step "Etherpad installer"

# ---------- prerequisite checks ----------
is_cmd git || fatal "git is required but not installed. See https://git-scm.com/downloads"

if ! is_cmd node; then
  fatal "Node.js is required (>= ${REQUIRED_NODE_MAJOR}). Install it from https://nodejs.org"
fi

NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [ "$NODE_MAJOR" -lt "$REQUIRED_NODE_MAJOR" ]; then
  fatal "Node.js >= ${REQUIRED_NODE_MAJOR} required. You have $(node --version)."
fi

if ! is_cmd pnpm; then
  step "Installing pnpm globally"
  is_cmd npm || fatal "npm not found. Install Node.js >= ${REQUIRED_NODE_MAJOR}."
  if ! npm install -g pnpm 2>/dev/null; then
    warn "Global npm install requires elevated permissions; retrying with sudo."
    is_cmd sudo || fatal "sudo not available. Install pnpm manually: https://pnpm.io/installation"
    sudo npm install -g pnpm || \
      fatal "Failed to install pnpm. Install it manually: https://pnpm.io/installation"
  fi
  is_cmd pnpm || \
    fatal "pnpm install reported success but pnpm is still not on PATH. Open a new shell and re-run."
fi

# ---------- clone ----------
if [ -d "$ETHERPAD_DIR" ]; then
  if [ -d "$ETHERPAD_DIR/.git" ]; then
    warn "$ETHERPAD_DIR already exists; updating to $ETHERPAD_BRANCH."
    cd "$ETHERPAD_DIR" || fatal "Cannot cd into $ETHERPAD_DIR"

    # Verify the existing checkout points at the expected remote.
    EXISTING_REMOTE=$(git remote get-url origin 2>/dev/null || echo "")
    if [ -n "$EXISTING_REMOTE" ] && [ "$EXISTING_REMOTE" != "$ETHERPAD_REPO" ]; then
      fatal "$ETHERPAD_DIR is checked out from '$EXISTING_REMOTE', expected '$ETHERPAD_REPO'. Refusing to overwrite."
    fi

    # Refuse to clobber meaningful local changes. pnpm-lock.yaml is excluded
    # because `pnpm i` rewrites it during installation, which would otherwise
    # make every re-run of the installer fail.
    DIRTY=$(git status --porcelain 2>/dev/null | awk '$2 != "pnpm-lock.yaml" {print}')
    if [ -n "$DIRTY" ]; then
      printf '%s\n' "$DIRTY" >&2
      fatal "$ETHERPAD_DIR has uncommitted changes. Commit/stash them or remove the directory."
    fi

    git fetch --tags --prune origin || fatal "git fetch failed in $ETHERPAD_DIR"

    # Discard any pnpm-lock.yaml changes from a prior pnpm install so the
    # subsequent checkout doesn't refuse to overwrite local changes.
    git checkout -- pnpm-lock.yaml 2>/dev/null || true

    # Switch to the requested branch / tag and fast-forward to it.
    if git show-ref --verify --quiet "refs/remotes/origin/$ETHERPAD_BRANCH"; then
      git checkout -B "$ETHERPAD_BRANCH" "origin/$ETHERPAD_BRANCH" || \
        fatal "git checkout $ETHERPAD_BRANCH failed"
    elif git show-ref --verify --quiet "refs/tags/$ETHERPAD_BRANCH"; then
      git checkout --detach "refs/tags/$ETHERPAD_BRANCH" || \
        fatal "git checkout tag $ETHERPAD_BRANCH failed"
    else
      fatal "Branch or tag '$ETHERPAD_BRANCH' not found on origin."
    fi

    INSTALLED_REV=$(git rev-parse --short HEAD)
    step "Updated $ETHERPAD_DIR to $ETHERPAD_BRANCH @ $INSTALLED_REV"
    cd - >/dev/null || exit 1
  else
    fatal "$ETHERPAD_DIR exists and is not a git checkout. Aborting."
  fi
else
  step "Cloning Etherpad ($ETHERPAD_BRANCH) into $ETHERPAD_DIR"
  git clone --depth 1 --branch "$ETHERPAD_BRANCH" "$ETHERPAD_REPO" "$ETHERPAD_DIR"
fi

cd "$ETHERPAD_DIR"

# ---------- install + build ----------
step "Installing dependencies (pnpm i)"
pnpm i

step "Building Etherpad (pnpm run build:etherpad)"
pnpm run build:etherpad

# ---------- done ----------
printf '\n%s🎉 Etherpad is installed in %s%s\n' "$green" "$ETHERPAD_DIR" "$reset"
printf 'To start Etherpad:\n'
printf '  cd %s && pnpm run prod\n' "$ETHERPAD_DIR"
printf 'Then open http://localhost:9001 in your browser.\n\n'

if [ "${ETHERPAD_RUN:-0}" = "1" ]; then
  step "Starting Etherpad on http://localhost:9001"
  exec pnpm run prod
fi
