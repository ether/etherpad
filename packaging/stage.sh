#!/usr/bin/env bash
# Stage the production tree for nfpm under staging/opt/etherpad.
# Run from the repo root after `pnpm install` and `pnpm run build:etherpad`.
# Used by .github/workflows/deb-package.yml and packaging/test-local.sh.
set -euxo pipefail

cd "$(dirname "$0")/.."

STAGE=staging/opt/etherpad
rm -rf staging
mkdir -p "${STAGE}"

# Production footprint = src/ + bin/ + metadata, plus a fresh
# production-only node_modules installed below. src/ already holds the
# admin + oidc builds from `build:etherpad`. Copying the workspace
# node_modules used to ship every devDependency (typescript, playwright,
# vitest, eslint, vite, ...) and the admin/ui/doc dependency trees, which
# pushed the .deb past GitHub's 100 MiB per-file limit for the apt repo.
cp -a src bin package.json pnpm-lock.yaml README.md LICENSE "${STAGE}/"
rm -rf "${STAGE}/src/node_modules" "${STAGE}/bin/node_modules" \
       "${STAGE}/src/tests" "${STAGE}/src/playwright.config.ts" \
       "${STAGE}/src/vitest.config.ts"

# Install production deps for the runtime workspace (root, src, bin) from
# the lockfile. pnpm installs the dependencies of every importer listed in
# the lockfile, even if its directory is missing, so drop the build-only
# importers from the staged lockfile and workspace file. Everything else
# (overrides, build policy) stays as-is so --frozen-lockfile still matches.
BUILD_ONLY='admin|doc|ui|admin/tools/openapi-codegen'
awk -v re="^  (${BUILD_ONLY}):\$" '
  /^importers:/ { imp = 1; print; next }
  imp && /^[^ ]/ { imp = 0; skip = 0 }
  imp && /^  [^ ]/ { skip = ($0 ~ re) }
  !skip { print }
' pnpm-lock.yaml > "${STAGE}/pnpm-lock.yaml"
grep -Ev "^  - (${BUILD_ONLY})\$" pnpm-workspace.yaml > "${STAGE}/pnpm-workspace.yaml"
( cd "${STAGE}" && CI=1 pnpm install --prod --frozen-lockfile )

# Ship the same minimal workspace file as before (same trick the
# Dockerfile uses) and no lockfile.
printf 'packages:\n  - src\n  - bin\n' > "${STAGE}/pnpm-workspace.yaml"
rm -f "${STAGE}/pnpm-lock.yaml"

mkdir -p packaging/etc
cp settings.json.template packaging/etc/settings.json.dist

# Purge test fixtures and docs from node_modules to shrink size.
find "${STAGE}/node_modules" -type d \
     \( -name test -o -name tests -o -name '__tests__' \
        -o -name example -o -name examples -o -name docs \) \
     -prune -exec rm -rf {} + 2>/dev/null || true
find "${STAGE}/node_modules" -type f \
     \( -name '*.md' -o -name '*.ts.map' -o -name '*.map' \
        -o -name 'CHANGELOG*' -o -name 'HISTORY*' \) \
     -delete 2>/dev/null || true
