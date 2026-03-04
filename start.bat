@echo off
REM Windows and symlinks do not get along with each other, so on Windows
REM `node_modules\ep_etherpad-lite` is sometimes a full copy of `src` not a
REM symlink to `src`. If it is a copy, Node.js sees `src\foo.js` and
REM `node_modules\ep_etherpad-lite\foo.js` as two independent modules with
REM independent state, when they should be treated as the same file. To work
REM around this, everything must consistently use either `src` or
REM `node_modules\ep_etherpad-lite` on Windows. Because some plugins access
REM Etherpad internals via `require('ep_etherpad-lite/foo')`,
REM `node_modules\ep_etherpad-lite` is used here.
cd src
pnpm run prod
