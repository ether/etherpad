#!/bin/bash
# Static checks on snap/snapcraft.yaml — purely structural, no snapcraft
# binary required. Catches schema drift before a slow `snapcraft pack`.
set -uo pipefail
TEST_NAME="snapcraft.yaml"
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

YAML="${SNAP_DIR}/snapcraft.yaml"
[ -f "${YAML}" ] || { fail "snapcraft.yaml exists at ${YAML}"; exit 1; }

# Use python3 for parsing — no extra deps.
python3 - "${YAML}" <<'PY' || exit 1
import sys, re, yaml
path = sys.argv[1]
with open(path) as f:
  data = yaml.safe_load(f)

failures = []

def check(cond, msg):
  print(f"  {'✓' if cond else '✗'} {msg}")
  if not cond: failures.append(msg)

# Required top-level keys.
for k in ("name","title","summary","description","base","confinement","apps","parts"):
  check(k in data, f"required key present: {k}")

# Name must be lowercase, no underscores, valid for snap store.
name = data.get("name","")
check(bool(re.match(r"^[a-z][a-z0-9-]{0,39}$", name)) and not name.endswith("-"),
      f"snap name '{name}' is store-valid")
check(name == "etherpad", "snap name is exactly 'etherpad' (no etherpad-lite)")

# core24 + strict.
check(data.get("base") == "core24", "base is core24")
check(data.get("confinement") == "strict", "confinement is strict")

# adopt-info points at a real part.
ai = data.get("adopt-info")
parts = data.get("parts", {})
check(ai in parts, f"adopt-info '{ai}' references an existing part")

# Daemon app shares the snap name → bare invocation works.
apps = data.get("apps", {})
daemon_apps = [n for n,v in apps.items() if "daemon" in v]
check(name in daemon_apps,
      f"daemon app shares snap name (so `{name}` is the bare command)")

# Apps don't reintroduce the legacy 'etherpad-lite' name anywhere.
flat = yaml.dump(data)
check("etherpad-lite" not in flat,
      "no 'etherpad-lite' references in snapcraft.yaml")

# settings.json env vars should NOT include EP_SETTINGS / EP_DATA_DIR
# (Etherpad doesn't read them; they trigger noisy warnings).
env = apps.get(name, {}).get("environment", {}) or {}
for forbidden in ("EP_SETTINGS","EP_DATA_DIR"):
  check(forbidden not in env,
        f"environment does not set unused var {forbidden}")

# PORT and IP env vars must be present so settings.json env-subst has defaults.
for required in ("PORT","IP","NODE_ENV"):
  check(required in env,
        f"environment sets {required}")

print()
print(f"{len(failures)} failure(s)" if failures else "OK")
sys.exit(1 if failures else 0)
PY
yaml_rc=$?

if [ "$yaml_rc" = 0 ]; then
  PASS_COUNT=$((PASS_COUNT + 1))
  pass "snapcraft.yaml structural checks all pass"
else
  FAIL_COUNT=$((FAIL_COUNT + 1))
  fail "snapcraft.yaml structural checks failed (see python output above)"
fi

return 0 2>/dev/null || exit 0
