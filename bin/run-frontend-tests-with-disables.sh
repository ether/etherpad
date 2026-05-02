#!/usr/bin/env bash
#
# Run the frontend test suite with awareness of a plugin's declared
# `disables` list (see doc/PLUGIN_FEATURE_DISABLES.md).
#
# A plugin that intentionally removes a baseline Etherpad feature MUST
# declare which feature tags it disables in its ep.json:
#
#   { "name": "ep_disable_chat", "disables": ["@feature:chat"], ... }
#
# This script enforces that contract with two passes:
#
#   1. Regression pass — every test NOT tagged with a disabled feature
#      must pass. Catches the case where the plugin breaks something
#      unrelated to the feature it claims to disable.
#
#   2. Honesty pass — every test that IS tagged with a disabled feature
#      must FAIL. If those tests pass, the plugin's `disables` claim is
#      wrong; the feature it says it disables actually still works.
#      Catches the case where a plugin opts out of tests it has no
#      right to skip.
#
# Both passes have to pass for CI to be green. A plugin can't quietly
# disable functionality without declaring it (pass 1 catches that), and
# can't quietly opt out of test coverage by declaring features it
# doesn't actually disable (pass 2 catches that).
#
# Usage:
#   bin/run-frontend-tests-with-disables.sh \
#     [--plugin-ep-json PATH] [-- <playwright args...>]
#
# Resolution order for the disables list:
#   1. EP_PLUGIN_DISABLES env var (comma- or space-separated)
#   2. --plugin-ep-json PATH (reads `.disables` JSON array)
#   3. Auto-detect: if exactly one ep_*/ep.json under plugin_packages/
#      declares disables, use it. Multiple disabling plugins → error.
#
# Run from src/ (where playwright.config.ts and node_modules live).

set -euo pipefail

EP_JSON=""
PLAYWRIGHT_ARGS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --plugin-ep-json)
      EP_JSON="$2"; shift 2;;
    --) shift; PLAYWRIGHT_ARGS+=("$@"); break;;
    *) PLAYWRIGHT_ARGS+=("$1"); shift;;
  esac
done

read_disables_from_json() {
  # Echo space-separated list of @feature:* tags from a JSON file's
  # top-level `disables` array. Empty if the file or field is missing.
  local file="$1"
  [[ -f "$file" ]] || return 0
  node -e "
    try {
      const j = JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'));
      const d = Array.isArray(j.disables) ? j.disables : [];
      process.stdout.write(d.join(' '));
    } catch (_) {}
  " "$file"
}

DISABLES=""
if [[ -n "${EP_PLUGIN_DISABLES:-}" ]]; then
  DISABLES="$(echo "$EP_PLUGIN_DISABLES" | tr ',' ' ')"
elif [[ -n "$EP_JSON" ]]; then
  DISABLES="$(read_disables_from_json "$EP_JSON")"
else
  # Auto-detect from plugin_packages/. Skip if 0 or >1 disabling plugins.
  declare -a CANDIDATES=()
  if [[ -d plugin_packages ]]; then
    while IFS= read -r f; do
      d="$(read_disables_from_json "$f")"
      [[ -n "$d" ]] && CANDIDATES+=("$d")
    done < <(find plugin_packages -maxdepth 3 -name ep.json -not -path '*/.versions/*' 2>/dev/null)
  fi
  if [[ ${#CANDIDATES[@]} -eq 1 ]]; then
    DISABLES="${CANDIDATES[0]}"
  elif [[ ${#CANDIDATES[@]} -gt 1 ]]; then
    echo "ERROR: multiple plugins declare disables, pass --plugin-ep-json explicitly:" >&2
    printf '  %s\n' "${CANDIDATES[@]}" >&2
    exit 2
  fi
fi

DISABLES="$(echo "$DISABLES" | xargs)" # trim
if [[ -z "$DISABLES" ]]; then
  echo "No 'disables' declared — running standard test suite."
  exec pnpm exec playwright test "${PLAYWRIGHT_ARGS[@]}"
fi

# Build the regex Playwright wants for --grep / --grep-invert.
# Tags are matched as substrings of the test title; @feature:chat is
# distinct enough that we don't need to anchor.
GREP_PATTERN="$(echo "$DISABLES" | tr ' ' '|')"

echo "Plugin disables: $DISABLES"
echo

echo "=== Pass 1: regression — tests NOT tagged with disabled features must pass ==="
pnpm exec playwright test --grep-invert "($GREP_PATTERN)" "${PLAYWRIGHT_ARGS[@]}"

echo
echo "=== Pass 2: honesty — tests tagged with $DISABLES must FAIL (feature is disabled) ==="
# Run with --reporter=list so we get test names but suppress the noisy
# default reporter output for expected failures. Capture the exit code
# without `set -e` aborting.
set +e
pnpm exec playwright test --grep "($GREP_PATTERN)" --reporter=list --retries=0 "${PLAYWRIGHT_ARGS[@]}"
PASS2_EXIT=$?
set -e

# Pass 2 SUCCEEDED (tests passed) is BAD: the plugin says it disables
# the feature but the feature works. Pass 2 FAILED (tests failed) is
# GOOD: the feature is genuinely disabled.
if [[ $PASS2_EXIT -eq 0 ]]; then
  echo
  echo "ERROR: plugin declares disables=[$DISABLES] but tests with those tags PASSED." >&2
  echo "       The plugin is opting out of tests it has no right to skip:" >&2
  echo "         - either the plugin isn't actually disabling those features," >&2
  echo "         - or ep.json's disables list is wrong." >&2
  exit 1
fi

echo
echo "Both passes succeeded — plugin's disables contract is honoured."
