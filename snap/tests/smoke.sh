#!/bin/bash
# Local smoke test for the etherpad snap.
# Rebuild → install → set port=9003 → wait → check listener → curl /health → tail logs.
# Run from the worktree root: bash snap/tests/smoke.sh
set -uo pipefail

WORKTREE="/home/jose/etherpad/etherpad-lite/.claude/worktrees/pkg-snap"
SNAP_FILE="${WORKTREE}/etherpad_2.6.1_amd64.snap"
TEST_PORT=9003
BUILD_LOG=/tmp/snapcraft-build.log

cd "${WORKTREE}" || exit 1

echo "==> Rebuilding snap (destructive mode)"
sudo rm -rf parts stage prime
sudo snapcraft pack --destructive-mode --verbose 2>&1 \
  | tee "${BUILD_LOG}" \
  | grep -E "Building|Staging|Priming|Packing|Created snap|Packed|error|Error|FAIL"

if [ ! -f "${SNAP_FILE}" ]; then
  echo "FAIL: ${SNAP_FILE} was not produced — see ${BUILD_LOG}"
  exit 1
fi

echo
echo "==> Installing snap"
sudo snap install --dangerous "${SNAP_FILE}"

echo
echo "==> Configuring test port ${TEST_PORT} (production default stays 9001)"
sudo snap set etherpad port="${TEST_PORT}"
sudo snap restart etherpad

echo
echo "==> Waiting 12s for plugin migration + bind"
sleep 12

echo
echo "==> Service status"
sudo snap services etherpad

echo
echo "==> Listening sockets in 9000-9009"
sudo ss -tlnp 2>&1 | grep -E ':900[0-9]' || echo "(nothing listening in 9000-9009)"

echo
echo "==> /health response"
curl -sS -o /tmp/health.body -w 'HTTP %{http_code}\n' "http://127.0.0.1:${TEST_PORT}/health"
echo "body: $(cat /tmp/health.body 2>/dev/null)"

echo
echo "==> Last 20 log lines"
sudo snap logs etherpad -n 25 | tail -20
