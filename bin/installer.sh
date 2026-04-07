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
REQUIRED_NODE_MAJOR=18

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
    warn "$ETHERPAD_DIR already exists; pulling latest changes."
    (cd "$ETHERPAD_DIR" && git pull --ff-only) || \
      fatal "git pull failed in existing $ETHERPAD_DIR"
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
