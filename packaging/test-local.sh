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

echo "==> Building staging tree"
rm -rf staging dist packaging/etc
mkdir -p staging/opt/etherpad packaging/etc dist
cp -a src bin package.json pnpm-workspace.yaml README.md LICENSE node_modules \
      staging/opt/etherpad/
printf 'packages:\n  - src\n  - bin\n' > staging/opt/etherpad/pnpm-workspace.yaml
cp settings.json.template packaging/etc/settings.json.dist

echo "==> Building .deb via nfpm (in container)"
VERSION="$(node -p 'require("./package.json").version')"
docker run --rm \
  -v "${REPO_ROOT}":/w -w /w \
  -e VERSION="${VERSION}" -e ARCH="${ARCH}" \
  goreleaser/nfpm:latest \
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
  test -L /opt/etherpad/src/plugin_packages
  [ "$(readlink /opt/etherpad/src/plugin_packages)" = "/var/lib/etherpad/plugin_packages" ]
  test -d /var/lib/etherpad/plugin_packages
  [ "$(stat -c %U /var/lib/etherpad/plugin_packages)" = "etherpad" ]
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
  docker exec -d "${CONTAINER_NAME}" sudo -u etherpad bash -c \
    'cd /opt/etherpad && NODE_ENV=production /usr/bin/etherpad >/tmp/etherpad.log 2>&1'
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
