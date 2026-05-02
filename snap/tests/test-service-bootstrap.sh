#!/bin/bash
# Unit tests for snap/local/bin/etherpad-service first-run bootstrap.
# Verifies that the wrapper:
#   - seeds settings.json from the upstream template into $SNAP_COMMON/etc
#   - rewrites the dirty default to sqlite at $SNAP_COMMON/var/etherpad.db
#   - rewrites ip/port literals to ${IP:…} / ${PORT:…} env-substitution
#   - leaves an existing settings.json untouched on subsequent runs
#   - exports PORT/IP from snapctl overrides
#
# We mock node, snapctl, and the SNAP/SNAP_COMMON dirs. node-mock writes
# its argv + selected env vars to a log file, then exits 0 instead of
# actually starting Etherpad.
set -uo pipefail
TEST_NAME="etherpad-service bootstrap"
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

REPO_ROOT="$(cd "${SNAP_DIR}/.." && pwd -P)"
TEMPLATE="${REPO_ROOT}/settings.json.template"
[ -f "${TEMPLATE}" ] || { fail "fixture: settings.json.template not found at ${TEMPLATE}"; exit 1; }

TMP=$(mktemp -d)
trap 'rm -rf "${TMP}"' EXIT

export SNAP="${TMP}/snap"
export SNAP_COMMON="${TMP}/common"
mkdir -p "${SNAP}/opt/etherpad/src" "${SNAP}/opt/node/bin" \
         "${TMP}/bin"

cp "${TEMPLATE}" "${SNAP}/opt/etherpad/settings.json.template"

# node mock: log argv + env vars we care about, exit 0 (do not exec server)
NODE_LOG="${TMP}/node-invocation.log"
cat > "${SNAP}/opt/node/bin/node" <<EOF
#!/bin/bash
{
  echo "ARGV: \$*"
  echo "PORT=\${PORT-unset}"
  echo "IP=\${IP-unset}"
  echo "NODE_ENV=\${NODE_ENV-unset}"
} > "${NODE_LOG}"
exit 0
EOF
chmod +x "${SNAP}/opt/node/bin/node"

# snapctl mock — controlled via SNAPCTL_PORT / SNAPCTL_IP env vars set per call.
cat > "${TMP}/bin/snapctl" <<'EOF'
#!/bin/bash
case "$1 $2" in
  "get port") printf '%s' "${SNAPCTL_PORT-}" ;;
  "get ip")   printf '%s' "${SNAPCTL_IP-}" ;;
  *)          exit 0 ;;
esac
EOF
chmod +x "${TMP}/bin/snapctl"
export PATH="${TMP}/bin:${PATH}"

WRAPPER="${WRAPPERS_DIR}/etherpad-service"

run_wrapper() {
  # Use env -i would strip too much; instead just clear the override vars.
  unset PORT IP NODE_ENV
  SNAPCTL_PORT="${1-}" SNAPCTL_IP="${2-}" bash "${WRAPPER}"
}

section "first-run seed and rewrite"

run_wrapper "" ""

SEEDED="${SNAP_COMMON}/etc/settings.json"
[ -f "${SEEDED}" ] && pass "settings.json seeded into \$SNAP_COMMON/etc" \
  || fail "settings.json seeded into \$SNAP_COMMON/etc" "missing: ${SEEDED}"

# dbType: dirty -> sqlite
assert_grep '"dbType": "sqlite"' "dbType rewritten to sqlite" \
  cat "${SEEDED}"

# filename: var/dirty.db -> $SNAP_COMMON/var/etherpad.db
assert_grep "${SNAP_COMMON}/var/etherpad.db" "sqlite filename points at \$SNAP_COMMON/var" \
  cat "${SEEDED}"

# ip / port: literal values -> env-substitution syntax
assert_grep '"ip": "${IP:0.0.0.0}"' "ip rewritten to \${IP:0.0.0.0}" \
  cat "${SEEDED}"
assert_grep '"port": "${PORT:9001}"' "port rewritten to \${PORT:9001}" \
  cat "${SEEDED}"

# dbSettings.port lower in the file MUST NOT have been touched (the sed
# uses 0,/.../ to bound to the first match).
dbsettings_port=$(grep -c '^[[:space:]]*"port":[[:space:]]*3306' "${SEEDED}" || true)
assert_eq "${dbsettings_port}" "1" "dbSettings.port (3306) untouched by ip/port rewrite"

section "writable directories created"

for d in etc var logs etherpad-app-var; do
  if [ -d "${SNAP_COMMON}/${d}" ]; then
    pass "\$SNAP_COMMON/${d} created"
  else
    fail "\$SNAP_COMMON/${d} created" "missing: ${SNAP_COMMON}/${d}"
  fi
done

section "snapctl overrides propagate to node env"

# Re-run with port=9003 (project test port), ip=127.0.0.1.
run_wrapper 9003 127.0.0.1

assert_grep "PORT=9003" "PORT exported from snapctl override" \
  cat "${NODE_LOG}"
assert_grep "IP=127.0.0.1" "IP exported from snapctl override" \
  cat "${NODE_LOG}"
assert_grep "NODE_ENV=production" "NODE_ENV=production exported" \
  cat "${NODE_LOG}"
assert_grep -- "--settings ${SEEDED}" "wrapper passes --settings explicitly" \
  cat "${NODE_LOG}"

section "second run does not re-seed"

# Mark the seeded settings.json so we can detect rewrites.
echo '/* TEST MARKER */' >> "${SEEDED}"
run_wrapper "" ""
if grep -q "TEST MARKER" "${SEEDED}"; then
  pass "existing settings.json preserved on subsequent run"
else
  fail "existing settings.json preserved on subsequent run" \
       "marker was removed — wrapper re-seeded the file"
fi

section "snapctl defaults when unset"

# Remove the seeded file and run with no overrides.
rm -f "${SEEDED}"
run_wrapper "" ""
assert_grep "PORT=9001" "PORT defaults to 9001 when snapctl is empty" \
  cat "${NODE_LOG}"
assert_grep "IP=0.0.0.0" "IP defaults to 0.0.0.0 when snapctl is empty" \
  cat "${NODE_LOG}"

return 0 2>/dev/null || exit 0
