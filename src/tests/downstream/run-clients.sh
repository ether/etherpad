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
  git clone --quiet "$repo" "$dir"
  # Fetch the exact pinned commit (works even when it is not a branch tip).
  git -C "$dir" fetch --quiet origin "$ref" 2>/dev/null || true
  git -C "$dir" checkout --quiet "$ref"

  (
    cd "$dir"
    case "$kind" in
      rust)
        eval "$vectorTest"
        eval "$smokeCmd"
        ;;
      node|desktop)
        pnpm install
        eval "$vectorTest"
        eval "$smokeCmd"
        ;;
      *)
        echo "::error::unknown client kind: $kind"; exit 1
        ;;
    esac
  ) || { echo "::error::downstream client '$name' failed"; fail=1; }
  echo "::endgroup::"
done < "$WORK/clients.tsv"

exit "$fail"
