#!/bin/bash

# Specify the path to your package.json file
PACKAGE_JSON_PATH="./src/package.json"

# Check if the file exists
if [ ! -f "$PACKAGE_JSON_PATH" ]; then
    echo "Error: package.json not found in the specified path."
    exit 1
fi

# Read the version from package.json into a variable
VERSION=$(jq -r '.version' "$PACKAGE_JSON_PATH")
git push origin master develop $VERSION
git push --tags
(cd ../ether.github.com && git push)