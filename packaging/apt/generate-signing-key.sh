#!/usr/bin/env bash
# One-time setup: generate a dedicated GPG keypair for signing the
# Etherpad apt repository's Release/InRelease files. Outputs go into
# ./etherpad-apt-{private,public}.asc in the directory you run this in.
#
# After running this script:
#   1. Paste the *private* key contents into a new GitHub repo/org secret
#      called APT_SIGNING_KEY (Settings → Secrets and variables → Actions
#      → New repository secret). Then delete the .asc file or move it to
#      a password manager — GitHub is the canonical store.
#   2. Hand the *public* key contents to whoever is wiring up the apt
#      workflow; it gets committed at packaging/apt/key.asc so end users
#      can pull it from https://ether.github.io/etherpad/key.asc.
#   3. Note the printed long key ID — the workflow uses it as
#      --default-key for `gpg --clearsign`.

set -euo pipefail

NAME_REAL="${NAME_REAL:-Etherpad APT Repository}"
NAME_EMAIL="${NAME_EMAIL:-contact@etherpad.org}"
EXPIRE_YEARS="${EXPIRE_YEARS:-5}"

OUT_DIR="$(pwd)"
PRIV="${OUT_DIR}/etherpad-apt-private.asc"
PUB="${OUT_DIR}/etherpad-apt-public.asc"

if [[ -e "${PRIV}" || -e "${PUB}" ]]; then
  echo "!! Output files already exist in ${OUT_DIR}:" >&2
  ls -la "${PRIV}" "${PUB}" 2>/dev/null >&2 || true
  echo "   Move/delete them first, or set OUT_DIR to a clean directory." >&2
  exit 1
fi

if ! command -v gpg >/dev/null 2>&1; then
  echo "!! gpg not found. Install with: sudo apt install gnupg" >&2
  exit 1
fi

echo "==> Generating Ed25519 signing key for: ${NAME_REAL} <${NAME_EMAIL}>"
echo "    Expires in ${EXPIRE_YEARS} years. No passphrase (CI uses it unattended)."

# Use a temp GNUPGHOME so we don't pollute the user's keyring with a
# CI-only key, and so subsequent re-runs don't need to delete keys.
TMP_GNUPG="$(mktemp -d)"
trap 'rm -rf "${TMP_GNUPG}"' EXIT
chmod 700 "${TMP_GNUPG}"
export GNUPGHOME="${TMP_GNUPG}"

gpg --batch --gen-key <<EOF
%no-protection
Key-Type: EDDSA
Key-Curve: ed25519
Subkey-Type: ECDH
Subkey-Curve: cv25519
Name-Real: ${NAME_REAL}
Name-Email: ${NAME_EMAIL}
Expire-Date: ${EXPIRE_YEARS}y
%commit
EOF

echo
echo "==> Key generated. Details:"
gpg --list-secret-keys --keyid-format=long "${NAME_EMAIL}"

KEY_ID="$(gpg --list-secret-keys --with-colons "${NAME_EMAIL}" \
            | awk -F: '/^sec/ {print $5; exit}')"

echo
echo "==> Exporting to ${OUT_DIR}/"
gpg --armor --export-secret-keys "${NAME_EMAIL}" > "${PRIV}"
gpg --armor --export             "${NAME_EMAIL}" > "${PUB}"
chmod 600 "${PRIV}"
chmod 644 "${PUB}"

echo
echo "Done."
echo
echo "  Private key (UPLOAD AS GITHUB SECRET 'APT_SIGNING_KEY'):"
echo "    ${PRIV}"
echo "  Public key (commit as packaging/apt/key.asc, hand to me):"
echo "    ${PUB}"
echo "  Long key ID (note this somewhere; used as --default-key in the workflow):"
echo "    ${KEY_ID}"
echo
echo "Next steps:"
echo "  1. Open https://github.com/ether/etherpad/settings/secrets/actions/new"
echo "     Name: APT_SIGNING_KEY"
echo "     Value: <paste the contents of ${PRIV}>"
echo "  2. Securely store ${PRIV} (password manager) or delete it after upload."
echo "  3. Send me ${PUB} (or its contents) for the public-key commit."
