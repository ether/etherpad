#!/bin/bash
# Unit tests for snap/hooks/configure.
# Validates port/ip values via a mocked snapctl. Restart-on-change paths
# are not tested here (require running snapd).
set -uo pipefail
TEST_NAME="configure hook"
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

TMP=$(mktemp -d)
trap 'rm -rf "${TMP}"' EXIT

# Mock snapctl: returns env-provided values for `get`, no-ops on other verbs.
cat > "${TMP}/snapctl" <<'EOF'
#!/bin/bash
case "$1 $2" in
  "get port")     printf '%s' "${SNAPCTL_PORT-}" ;;
  "get ip")       printf '%s' "${SNAPCTL_IP-}" ;;
  "services etherpad.etherpad") echo "etherpad.etherpad enabled inactive -" ;;
  "restart etherpad.etherpad")  exit 0 ;;
  *) exit 0 ;;
esac
EOF
chmod +x "${TMP}/snapctl"

HOOK="${HOOKS_DIR}/configure"

run_hook() {
  env -i PATH="${TMP}:/usr/bin:/bin" \
      SNAPCTL_PORT="${1-}" SNAPCTL_IP="${2-}" \
      bash "${HOOK}"
}

section "port validation"

# Tests using the project-reserved test port 9003 (per memory).
assert_exit 0 "valid port 9003"           run_hook 9003 ""
assert_exit 0 "valid port 1"              run_hook 1 ""
assert_exit 0 "valid port 65535"          run_hook 65535 ""
assert_exit 0 "empty port (no override)"  run_hook "" ""

assert_exit 1 "rejects port 0"            run_hook 0 ""
assert_exit 1 "rejects port 70000"        run_hook 70000 ""
assert_exit 1 "rejects port 'abc'"        run_hook abc ""
assert_exit 1 "rejects port '-1'"         run_hook -1 ""

assert_grep "1-65535" "out-of-range error message references valid range" \
  run_hook 99999 ""

section "ip validation"

assert_exit 0 "valid ip 0.0.0.0"          run_hook "" "0.0.0.0"
assert_exit 0 "valid ip 127.0.0.1"        run_hook "" "127.0.0.1"
assert_exit 0 "valid ip ::1"              run_hook "" "::1"
assert_exit 0 "empty ip (no override)"    run_hook "" ""

assert_exit 1 "rejects ip 'not-an-ip'"    run_hook "" "not-an-ip"
assert_exit 1 "rejects ip 'localhost'"    run_hook "" "localhost"

assert_grep "valid IPv4/IPv6" "ip error message mentions IPv4/IPv6" \
  run_hook "" "bogus"

return 0 2>/dev/null || exit 0
