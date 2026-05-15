#!/usr/bin/env bash
# Build the .deb locally and run it through the same smoke test as CI,
# in a throwaway systemd-enabled Docker container. Mirrors the steps in
# .github/workflows/deb-package.yml so failures here predict CI failures.
#
# Usage: packaging/test-local.sh           # build + smoke test
#        packaging/test-local.sh --shell   # leave a shell open after smoke test
#        packaging/test-local.sh --build-only
#
# Requirements: docker, node, pnpm. nfpm is fetched into the container.

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "${REPO_ROOT}"

ARCH="${ARCH:-amd64}"
NFPM_VERSION="${NFPM_VERSION:-v2.43.0}"
SYSTEMD_IMAGE="${SYSTEMD_IMAGE:-jrei/systemd-ubuntu:24.04}"
CONTAINER_NAME="${CONTAINER_NAME:-etherpad-deb-test}"

MODE=smoke
NO_SYSTEMD=
for arg in "$@"; do
  case "$arg" in
    --shell)        MODE=shell ;;
    --build-only)   MODE=build ;;
    --no-systemd)   NO_SYSTEMD=1 ;;
    *) echo "unknown arg: $arg" >&2; exit 2 ;;
  esac
done

echo "==> Refreshing dependencies (matches CI)"
# CI=1 makes pnpm non-interactive (so it doesn't prompt on a clean reinstall).
CI=1 pnpm install --frozen-lockfile

echo "==> Building staging tree"
rm -rf staging dist packaging/etc
mkdir -p staging/opt/etherpad packaging/etc dist
cp -a src bin package.json pnpm-workspace.yaml README.md LICENSE node_modules \
      staging/opt/etherpad/
printf 'packages:\n  - src\n  - bin\n' > staging/opt/etherpad/pnpm-workspace.yaml
cp settings.json.template packaging/etc/settings.json.dist

echo "==> Building .deb via nfpm ${NFPM_VERSION} (in container)"
VERSION="$(node -p 'require("./package.json").version')"
# Pin to NFPM_VERSION so local builds match what CI produces. The
# goreleaser/nfpm tag drops the leading "v".
docker run --rm \
  -v "${REPO_ROOT}":/w -w /w \
  -e VERSION="${VERSION}" -e ARCH="${ARCH}" \
  "goreleaser/nfpm:${NFPM_VERSION#v}" \
  package --packager deb -f packaging/nfpm.yaml --target dist/

DEB_FILE="$(ls dist/etherpad_*_${ARCH}.deb | head -1)"
echo "==> Built: ${DEB_FILE}"
dpkg-deb -I "${DEB_FILE}" | sed 's/^/    /'

if [ "${MODE}" = "build" ]; then
  exit 0
fi

docker rm -f "${CONTAINER_NAME}" >/dev/null 2>&1 || true
trap '[ "${MODE}" = shell ] || docker rm -f "${CONTAINER_NAME}" >/dev/null 2>&1 || true' EXIT

if [ -z "${NO_SYSTEMD}" ]; then
  echo "==> Launching systemd container (${SYSTEMD_IMAGE})"
  # systemd-in-docker on cgroups v2 needs: --privileged, --cgroupns=host,
  # rw mount of /sys/fs/cgroup, and tmpfs for /run + /run/lock.
  if ! docker run -d --name "${CONTAINER_NAME}" \
        --privileged --cgroupns=host \
        --tmpfs /tmp --tmpfs /run --tmpfs /run/lock \
        -v /sys/fs/cgroup:/sys/fs/cgroup:rw \
        -v "${REPO_ROOT}/dist":/dist:ro \
        -p 9001:9001 \
        "${SYSTEMD_IMAGE}" >/dev/null; then
    echo "!! docker run failed; rerun with --no-systemd to skip the systemd path."
    exit 1
  fi

  echo "==> Waiting for systemd in container to be ready"
  ready=
  for i in $(seq 1 30); do
    state="$(docker inspect -f '{{.State.Status}}' "${CONTAINER_NAME}" 2>/dev/null || echo missing)"
    if [ "${state}" != "running" ]; then
      echo "!! container exited (state=${state}). Last logs:"
      docker logs "${CONTAINER_NAME}" 2>&1 | tail -50 || true
      echo
      echo "!! Tip: rerun with --no-systemd to skip the systemd-in-Docker"
      echo "   step and validate everything else (postinstall, wrapper,"
      echo "   plugin paths, /health under a manual launch)."
      exit 1
    fi
    if docker exec "${CONTAINER_NAME}" systemctl list-units --type=target >/dev/null 2>&1; then
      ready=1; break
    fi
    sleep 1
  done
  [ -n "${ready}" ] || { echo "!! systemd never came up"; docker logs "${CONTAINER_NAME}" 2>&1 | tail -50; exit 1; }
else
  # Reuse whichever ubuntu-ish image is already on disk to avoid a
  # registry round-trip (handy on flaky networks).
  PLAIN_IMAGE="${PLAIN_IMAGE:-}"
  if [ -z "${PLAIN_IMAGE}" ]; then
    for candidate in ubuntu:24.04 "${SYSTEMD_IMAGE}" ubuntu:latest debian:stable; do
      if docker image inspect "${candidate}" >/dev/null 2>&1; then
        PLAIN_IMAGE="${candidate}"
        break
      fi
    done
    : "${PLAIN_IMAGE:=ubuntu:24.04}"
  fi
  echo "==> Launching plain container (--no-systemd, image=${PLAIN_IMAGE})"
  docker run -d --name "${CONTAINER_NAME}" \
    --entrypoint /bin/sh \
    --tmpfs /tmp --tmpfs /run \
    -v "${REPO_ROOT}/dist":/dist:ro \
    -p 9001:9001 \
    "${PLAIN_IMAGE}" -c 'sleep infinity' >/dev/null
fi

echo "==> Installing nodejs + the .deb inside the container"
docker exec "${CONTAINER_NAME}" bash -lc '
  set -euo pipefail
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq curl ca-certificates gnupg
  curl -fsSL https://deb.nodesource.com/setup_lts.x | bash - >/dev/null
  apt-get install -y -qq nodejs
  dpkg -i /dist/etherpad_*_'"${ARCH}"'.deb || apt-get install -f -y -qq
'

echo "==> Asserting postinstall results"
docker exec "${CONTAINER_NAME}" bash -lc '
  set -eux
  test -x /usr/bin/etherpad
  test -f /etc/etherpad/settings.json
  test -L /opt/etherpad/settings.json
  test -L /opt/etherpad/var
  [ "$(readlink /opt/etherpad/var)" = "/var/lib/etherpad/var" ]
  # plugin_packages must stay in-tree -- Node.js resolves symlinks to
  # realpath before walking node_modules, so symlinking it outside /opt
  # broke require("ep_etherpad-lite/...") in admin-installed plugins.
  # See ether/ep_comments_page#416.
  test -d /opt/etherpad/src/plugin_packages
  test ! -L /opt/etherpad/src/plugin_packages
  [ "$(stat -c %G /opt/etherpad/src/plugin_packages)" = "etherpad" ]
  [ "$(stat -c %a /opt/etherpad/src/plugin_packages)" = "2775" ]
  [ "$(stat -c %G /opt/etherpad/src/node_modules)" = "etherpad" ]
  test -f /var/lib/etherpad/var/installed_plugins.json
  grep -q "ep_etherpad-lite" /var/lib/etherpad/var/installed_plugins.json
  grep -q "\"dbType\": \"sqlite\"" /etc/etherpad/settings.json
  id etherpad
'

if [ -z "${NO_SYSTEMD}" ]; then
  echo "==> Starting etherpad.service"
  docker exec "${CONTAINER_NAME}" systemctl start etherpad
else
  echo "==> Starting etherpad manually (no systemd in container)"
  docker exec -d "${CONTAINER_NAME}" runuser -u etherpad -- \
    bash -c 'cd /opt/etherpad && NODE_ENV=production /usr/bin/etherpad >/tmp/etherpad.log 2>&1'
fi

echo "==> Waiting for /health"
ok=
for i in $(seq 1 30); do
  if docker exec "${CONTAINER_NAME}" curl -fsS http://127.0.0.1:9001/health >/dev/null 2>&1; then
    ok=1; break
  fi
  sleep 2
done

if [ -z "${ok}" ]; then
  echo "!! /health never responded — dumping logs:"
  if [ -z "${NO_SYSTEMD}" ]; then
    docker exec "${CONTAINER_NAME}" journalctl -u etherpad --no-pager -n 200 || true
  else
    docker exec "${CONTAINER_NAME}" tail -n 200 /tmp/etherpad.log || true
  fi
  exit 1
fi

echo "==> /health OK"
docker exec "${CONTAINER_NAME}" curl -fsS http://127.0.0.1:9001/health
echo

echo "==> Asserting upgrade-from-symlink migration (ether/ep_comments_page#416)"
# Stop etherpad, recreate the pre-fix symlink layout with a marker plugin,
# re-run the postinst, and verify the migration restored the in-tree
# directory and preserved the marker payload.
if [ -z "${NO_SYSTEMD}" ]; then
  docker exec "${CONTAINER_NAME}" systemctl stop etherpad
fi
docker exec "${CONTAINER_NAME}" bash -lc '
  set -eux
  rm -rf /opt/etherpad/src/plugin_packages
  mkdir -p /var/lib/etherpad/plugin_packages/.versions/ep_migration_marker
  echo "{\"name\":\"ep_migration_marker\"}" \
    > /var/lib/etherpad/plugin_packages/.versions/ep_migration_marker/package.json
  chown -R etherpad:etherpad /var/lib/etherpad/plugin_packages
  ln -sfn /var/lib/etherpad/plugin_packages /opt/etherpad/src/plugin_packages
  dpkg-reconfigure etherpad
  test -d /opt/etherpad/src/plugin_packages
  test ! -L /opt/etherpad/src/plugin_packages
  test -f /opt/etherpad/src/plugin_packages/.versions/ep_migration_marker/package.json
  [ "$(stat -c %a /opt/etherpad/src/plugin_packages)" = "2775" ]
'

echo "==> Staging ep_layout_trip_wire fixture and verifying it loads (ether/ep_comments_page#416)"
# Copy the fixture into the container under .versions/, wire up the
# symlinks live-plugin-manager would normally create, and list it in
# installed_plugins.json so etherpad picks it up on start. The fixture
# loads several ep_etherpad-lite/* modules at require-time, which was
# the exact failure mode in #416.
docker cp "${REPO_ROOT}/packaging/test-fixtures/ep_layout_trip_wire" \
  "${CONTAINER_NAME}:/tmp/ep_layout_trip_wire"
docker exec "${CONTAINER_NAME}" bash -lc '
  set -eux
  install -d -o etherpad -g etherpad -m 2775 /opt/etherpad/src/plugin_packages/.versions
  rm -rf /opt/etherpad/src/plugin_packages/.versions/ep_layout_trip_wire@1.0.0
  mv /tmp/ep_layout_trip_wire \
    /opt/etherpad/src/plugin_packages/.versions/ep_layout_trip_wire@1.0.0
  ln -sfn .versions/ep_layout_trip_wire@1.0.0 \
    /opt/etherpad/src/plugin_packages/ep_layout_trip_wire
  ln -sfn ../plugin_packages/ep_layout_trip_wire \
    /opt/etherpad/src/node_modules/ep_layout_trip_wire
  chown -R etherpad:etherpad \
    /opt/etherpad/src/plugin_packages/.versions/ep_layout_trip_wire@1.0.0 \
    /opt/etherpad/src/plugin_packages/ep_layout_trip_wire \
    /opt/etherpad/src/node_modules/ep_layout_trip_wire
  echo "{\"plugins\":[{\"name\":\"ep_etherpad-lite\",\"version\":\"0.0.0\"},{\"name\":\"ep_layout_trip_wire\",\"version\":\"1.0.0\"}]}" \
    > /var/lib/etherpad/var/installed_plugins.json
  chown etherpad:etherpad /var/lib/etherpad/var/installed_plugins.json
'

if [ -z "${NO_SYSTEMD}" ]; then
  docker exec "${CONTAINER_NAME}" systemctl start etherpad
else
  docker exec -d "${CONTAINER_NAME}" runuser -u etherpad -- \
    bash -c "cd /opt/etherpad && NODE_ENV=production /usr/bin/etherpad >/tmp/etherpad.log 2>&1"
fi

echo "==> Waiting for /health (after fixture restart)"
ok=
for i in $(seq 1 30); do
  if docker exec "${CONTAINER_NAME}" curl -fsS http://127.0.0.1:9001/health >/dev/null 2>&1; then
    ok=1; break
  fi
  sleep 2
done
[ -n "${ok}" ] || { echo "!! /health never came back after staging fixture"; \
  if [ -z "${NO_SYSTEMD}" ]; then \
    docker exec "${CONTAINER_NAME}" journalctl -u etherpad --no-pager -n 300; \
  else \
    docker exec "${CONTAINER_NAME}" tail -n 300 /tmp/etherpad.log; \
  fi; exit 1; }

if [ -z "${NO_SYSTEMD}" ]; then
  docker exec "${CONTAINER_NAME}" bash -lc '
    journalctl -u etherpad --no-pager -n 500 \
      | grep -F "ep_layout_trip_wire: plugin_packages layout OK"
    if journalctl -u etherpad --no-pager -n 500 \
        | grep -E "Cannot find module .ep_etherpad-lite"; then
      echo "!! ep_etherpad-lite require failed inside installed plugin" >&2
      exit 1
    fi
  '
else
  docker exec "${CONTAINER_NAME}" bash -lc '
    grep -F "ep_layout_trip_wire: plugin_packages layout OK" /tmp/etherpad.log
    if grep -E "Cannot find module .ep_etherpad-lite" /tmp/etherpad.log; then
      echo "!! ep_etherpad-lite require failed inside installed plugin" >&2
      exit 1
    fi
  '
fi
echo "==> Trip-wire fixture loaded cleanly"

if [ "${MODE}" = "shell" ]; then
  echo
  echo "Container left running as '${CONTAINER_NAME}'. Useful commands:"
  echo "  docker exec -it ${CONTAINER_NAME} bash"
  echo "  docker exec ${CONTAINER_NAME} journalctl -u etherpad -f"
  echo "  curl http://127.0.0.1:9001/"
  echo "Stop with:  docker rm -f ${CONTAINER_NAME}"
  exit 0
fi

echo "==> Purging the package"
if [ -z "${NO_SYSTEMD}" ]; then
  docker exec "${CONTAINER_NAME}" systemctl stop etherpad
else
  docker exec "${CONTAINER_NAME}" pkill -f 'node.*server.ts' || true
fi
docker exec "${CONTAINER_NAME}" dpkg --purge etherpad
docker exec "${CONTAINER_NAME}" bash -c '! id etherpad 2>/dev/null'

echo "==> All checks passed."
