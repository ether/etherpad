#!/usr/bin/env bash
#
# Runs each enabled downstream client from clients.json against an already-booted
# Etherpad: clone @ pinned ref, set up its toolchain, point it at core's freshly
# generated wire-vectors fixture, then run the client's vectorTest + smokeCmd.
#
# The fixture is injected via $ETHERPAD_WIRE_VECTORS (absolute) so clients test
# against CURRENT core's serialization, not their vendored snapshot. The smoke
# reaches the server via $ETHERPAD_SMOKE_URL + $ETHERPAD_SMOKE_APIKEY.
#
# Env (all optional except APIKEY):
#   SMOKE_URL      default http://localhost:9003
#   SMOKE_APIKEY   required for the live smoke (clients skip cleanly without it)
#   MANIFEST       default src/tests/downstream/clients.json (relative to repo root)
#   WIRE_VECTORS   default <repo>/src/tests/fixtures/wire-vectors.json
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
MANIFEST="${MANIFEST:-$REPO_ROOT/src/tests/downstream/clients.json}"
WIRE_VECTORS="${WIRE_VECTORS:-$REPO_ROOT/src/tests/fixtures/wire-vectors.json}"
SMOKE_URL="${SMOKE_URL:-http://localhost:9003}"
SMOKE_APIKEY="${SMOKE_APIKEY:-}"

[ -f "$WIRE_VECTORS" ] || { echo "::error::fixture not found: $WIRE_VECTORS"; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

MANIFEST="$MANIFEST" node -e '
  const c = require(process.env.MANIFEST).filter((x) => x.enabled);
  for (const x of c) {
    process.stdout.write([x.name, x.repo, x.ref, x.kind, x.vectorTest, x.smokeCmd].join("\t") + "\n");
  }
' > "$WORK/clients.tsv"

if [ ! -s "$WORK/clients.tsv" ]; then
  echo "No downstream clients enabled. Nothing to run."
  exit 0
fi

export ETHERPAD_WIRE_VECTORS="$WIRE_VECTORS"
export ETHERPAD_SMOKE_URL="$SMOKE_URL"
export ETHERPAD_SMOKE_APIKEY="$SMOKE_APIKEY"

fail=0
while IFS=$'\t' read -r name repo ref kind vectorTest smokeCmd; do
  echo "::group::$name ($kind) @ ${ref:0:12}"
  dir="$WORK/$name"
  # Everything — clone, checkout, AND the tests — runs inside one guarded
  # subshell so a single client's failure becomes a per-client failure (fail=1)
  # and the loop continues to the rest. NOTE: `set -e` is suspended inside a
  # subshell used as an `||` operand, so every step is guarded with an explicit
  # `|| exit 1` rather than relying on `set -e`. The manifest commands are a
  # trusted in-repo allowlist; running them via `bash -c` (not `eval`) keeps
  # them out of this script's own shell.
  (
    git clone --quiet "$repo" "$dir" || exit 1
    # A default clone has all branch heads; fetch the pinned commit only if it
    # is not already reachable (e.g. a non-branch-tip SHA). Fetch errors are
    # NOT suppressed so the real cause surfaces instead of a vague checkout fail.
    if ! git -C "$dir" cat-file -e "${ref}^{commit}" 2>/dev/null; then
      git -C "$dir" fetch --quiet origin "$ref" || exit 1
    fi
    git -C "$dir" checkout --quiet "$ref" || exit 1

    cd "$dir" || exit 1
    case "$kind" in
      rust)
        bash -c "$vectorTest" || exit 1
        bash -c "$smokeCmd" || exit 1
        ;;
      node|desktop)
        pnpm install || exit 1
        bash -c "$vectorTest" || exit 1
        bash -c "$smokeCmd" || exit 1
        ;;
      *)
        echo "::error::unknown client kind: $kind"; exit 1
        ;;
    esac
  ) || { echo "::error::downstream client '$name' failed (clone/checkout/test)"; fail=1; }
  echo "::endgroup::"
done < "$WORK/clients.tsv"

exit "$fail"
