#!/bin/sh

set -e

for dir in node_modules/ep_*; do
  dir=${dir#node_modules/}
  [ "$dir" != ep_etherpad-lite ] || continue
  pnpm run checkPlugins "$dir" autopush
done
