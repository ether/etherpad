#!/bin/bash
set -euo pipefail

# Specify the path to your package.json file
PACKAGE_JSON_PATH="./src/package.json"

# Check if the file exists
if [ ! -f "$PACKAGE_JSON_PATH" ]; then
    echo "Error: package.json not found in the specified path."
    exit 1
fi

# Read the version from package.json into a variable
VERSION=$(jq -r '.version' "$PACKAGE_JSON_PATH")
# --atomic: if any ref is rejected (e.g. by branch protection), push none of
# them and fail the job instead of shipping a tag with develop left behind.
git push --atomic origin master develop "$VERSION" "v$VERSION"
(cd ../ether.github.com && git push)