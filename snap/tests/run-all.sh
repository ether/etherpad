#!/bin/bash
# Runs every test-*.sh under snap/tests/ and reports a final summary.
# Intended to be runnable both locally (`bash snap/tests/run-all.sh`)
# and in CI (`.github/workflows/snap-build.yml`). No snapd, snapcraft,
# or sudo required — every test mocks the snap surface.
set -uo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

TESTS=(test-snapcraft-yaml.sh test-cli.sh test-configure.sh test-service-bootstrap.sh)

# Bash-syntax sanity check on every wrapper / hook before running anything.
echo "## bash -n syntax check"
for f in ../local/bin/*.sh ../local/bin/etherpad-cli ../local/bin/etherpad-service \
         ../local/bin/etherpad-healthcheck-wrapper ../hooks/configure; do
  [ -f "$f" ] || continue
  if bash -n "$f" 2>/dev/null; then
    printf '  \033[32m✓\033[0m %s\n' "$f"
  else
    printf '  \033[31m✗\033[0m %s\n' "$f"
    bash -n "$f"
    exit 1
  fi
done

TOTAL_PASS=0
TOTAL_FAIL=0

for t in "${TESTS[@]}"; do
  echo
  echo "## ${t}"
  PASS_COUNT=0 FAIL_COUNT=0
  # Source so child counters bubble up.
  set +u
  source "./${t}"
  set -u
  TOTAL_PASS=$((TOTAL_PASS + PASS_COUNT))
  TOTAL_FAIL=$((TOTAL_FAIL + FAIL_COUNT))
done

echo
echo "==========================="
printf '  Passed:  %d\n' "${TOTAL_PASS}"
printf '  Failed:  %d\n' "${TOTAL_FAIL}"
echo "==========================="

[ "${TOTAL_FAIL}" = 0 ]
