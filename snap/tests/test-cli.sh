#!/bin/bash
# Unit tests for snap/local/bin/etherpad-cli.
# Exercises path-traversal rejection, extension dispatch, default-case
# rejection, no-args usage, and missing-script rejection — all with a
# mocked $SNAP root so no real install is needed.
set -uo pipefail
TEST_NAME="etherpad-cli"
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

TMP=$(mktemp -d)
trap 'rm -rf "${TMP}"' EXIT

# Layout: $SNAP/opt/etherpad/bin/{checkPad.sh,importSqlFile.ts,orphan.txt}
#         $SNAP/opt/node/bin/node (mock that just echoes its argv)
mkdir -p "${TMP}/opt/etherpad/bin" "${TMP}/opt/node/bin"
cat > "${TMP}/opt/node/bin/node" <<'EOF'
#!/bin/bash
echo "node-mock argv: $*"
EOF
chmod +x "${TMP}/opt/node/bin/node"
cat > "${TMP}/opt/etherpad/bin/checkPad.sh" <<'EOF'
#!/bin/bash
echo "checkPad.sh args: $*"
EOF
chmod +x "${TMP}/opt/etherpad/bin/checkPad.sh"
touch "${TMP}/opt/etherpad/bin/importSqlFile.ts"
touch "${TMP}/opt/etherpad/bin/orphan.txt"

CLI="${WRAPPERS_DIR}/etherpad-cli"
export SNAP="${TMP}"

section "path-traversal rejection"

# We assert exit code == 2 and that the stderr message matches "invalid"
run_cli() { "${CLI}" "$@"; }

assert_exit 2 "rejects ../../etc/passwd"          run_cli "../../etc/passwd"
assert_exit 2 "rejects subdir/script.ts"          run_cli "subdir/script.ts"
assert_exit 2 "rejects ..hidden"                  run_cli "..hidden"
assert_exit 2 "rejects empty argument"            run_cli ""

assert_grep "invalid script name" "traversal error message mentions 'invalid'" \
  run_cli "../etc/passwd"

section "missing / unsupported scripts"

assert_exit 2 "rejects nonexistent.ts"            run_cli "nonexistent.ts"
assert_grep "no such script" "missing-script message" \
  run_cli "nonexistent.ts"

assert_exit 2 "rejects orphan.txt (no .ts/.sh)"   run_cli "orphan.txt"
assert_grep "unsupported script type" "unsupported-extension message" \
  run_cli "orphan.txt"

section "valid dispatch"

# .sh runs the script directly
out=$("${CLI}" "checkPad.sh" hello world 2>&1) || true
assert_eq "$out" "checkPad.sh args: hello world" "checkPad.sh forwards args"

# .ts runs node --import tsx with the script path appended
out=$("${CLI}" "importSqlFile.ts" --some-arg 2>&1) || true
case "$out" in
  *"--import tsx/esm"*"importSqlFile.ts"*"--some-arg"*) pass "importSqlFile.ts dispatched via node tsx" ;;
  *) fail "importSqlFile.ts dispatched via node tsx" "got: $out" ;;
esac

section "no-args usage"

out=$("${CLI}" 2>&1) || true
case "$out" in
  *"Usage: etherpad.cli"*"checkPad.sh"*"importSqlFile.ts"*) pass "no-args prints usage and lists scripts" ;;
  *) fail "no-args prints usage and lists scripts" "got: $out" ;;
esac

# Summary handed back to the runner via env counters.
return 0 2>/dev/null || exit 0
