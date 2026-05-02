#!/bin/bash
# Tiny helpers for the snap wrapper test scripts. Source from each test.
set -uo pipefail

# Counters maintained by the runner.
: "${PASS_COUNT:=0}"
: "${FAIL_COUNT:=0}"
: "${TEST_NAME:?TEST_NAME must be set by the calling script}"

# Path to the wrapper / hook directory, computed once.
SNAP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
WRAPPERS_DIR="${SNAP_DIR}/local/bin"
HOOKS_DIR="${SNAP_DIR}/hooks"

red()   { printf '\033[31m%s\033[0m' "$*"; }
green() { printf '\033[32m%s\033[0m' "$*"; }
gray()  { printf '\033[90m%s\033[0m' "$*"; }

pass() {
  PASS_COUNT=$((PASS_COUNT + 1))
  printf '  %s %s\n' "$(green ✓)" "$1"
}

fail() {
  FAIL_COUNT=$((FAIL_COUNT + 1))
  printf '  %s %s\n' "$(red ✗)" "$1"
  if [ -n "${2:-}" ]; then
    printf '    %s\n' "$(gray "$2")"
  fi
}

# assert_eq actual expected name
assert_eq() {
  local actual="$1" expected="$2" name="$3"
  if [ "$actual" = "$expected" ]; then
    pass "$name"
  else
    fail "$name" "expected: $(printf '%q' "$expected")  got: $(printf '%q' "$actual")"
  fi
}

# assert_exit cmd expected_exit name [stdin]
assert_exit() {
  local expected="$1" name="$2"; shift 2
  local out actual
  out=$("$@" 2>&1) || true
  actual=$?
  # bash quirk: $? from the assignment is the assignment's, not the command's.
  # Re-run inline to capture exit:
  "$@" >/dev/null 2>&1
  actual=$?
  if [ "$actual" = "$expected" ]; then
    pass "$name"
  else
    fail "$name" "expected exit $expected, got $actual; output: $out"
  fi
}

# assert_grep cmd needle name — fail if cmd's combined output doesn't match
assert_grep() {
  local needle="$1" name="$2"; shift 2
  local out
  out=$("$@" 2>&1 || true)
  if printf '%s' "$out" | grep -q -F -- "$needle"; then
    pass "$name"
  else
    fail "$name" "expected output to contain: $needle; got: $(printf '%s' "$out" | head -3)"
  fi
}

section() {
  printf '\n%s %s\n' "$(gray '##')" "$1"
}
