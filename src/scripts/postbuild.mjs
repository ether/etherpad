/**
 * Post-build script: write trailing-slash bridge files so that
 * plugins calling require('ep_etherpad-lite/node/eejs/') (with trailing slash)
 * find a real file at the resolved path.
 *
 * Node's wildcard exports map `"./node/*": "./dist-cjs/node/*.cjs"` resolves
 * `node/eejs/` by substituting `*` = `eejs/`, producing the target path
 * `./dist-cjs/node/eejs/.cjs` (an empty basename).  A file literally named
 * `.cjs` (empty stem) satisfies that resolution.
 */
import {writeFileSync, mkdirSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

// scripts/postbuild.mjs lives in src/scripts/, so src/ is one level up.
const srcRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const targets = [
  [join(srcRoot, 'dist-cjs/node/eejs/.cjs'), "module.exports = require('./index.cjs');\n"],
  [join(srcRoot, 'dist/node/eejs/.mjs'),     "export * from './index.mjs';\n"],
];

for (const [filePath, content] of targets) {
  mkdirSync(dirname(filePath), {recursive: true});
  writeFileSync(filePath, content);
  console.log(`postbuild: wrote ${filePath}`);
}
console.log(`postbuild: wrote ${targets.length} trailing-slash bridges`);
