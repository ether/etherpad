// Walks src/package.json's exports map and asserts every glob target
// resolves to an existing file under dist/ or dist-cjs/. Exit 0 on
// success, 1 on any missing file.

import { existsSync, readdirSync, statSync, promises as fsp } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = resolve(here, '..');

const pkg = JSON.parse(await fsp.readFile(join(srcRoot, 'package.json'), 'utf8'));
const exportsMap = pkg.exports as Record<string, unknown>;

const errors: string[] = [];

function walk(dir: string, suffix: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full, suffix));
    else if (full.endsWith(suffix)) out.push(full);
  }
  return out;
}

function checkTarget(pattern: string, target: string) {
  if (!target.startsWith('./')) {
    errors.push(`Target ${target} does not start with './' (pattern ${pattern})`);
    return;
  }
  const targetAbs = resolve(srcRoot, target.replace(/^\.\//, ''));
  if (target.includes('*')) {
    const [prefix, suffix] = target.split('*');
    const prefixAbs = resolve(srcRoot, prefix.replace(/^\.\//, ''));
    const baseDir = prefix.endsWith('/') ? prefixAbs : dirname(prefixAbs);
    const matches = walk(baseDir, suffix);
    if (matches.length === 0) {
      errors.push(`Pattern ${pattern} -> ${target} has zero matching files`);
    }
  } else {
    if (!existsSync(targetAbs)) {
      errors.push(`Pattern ${pattern} -> ${target} (file does not exist)`);
    }
  }
}

for (const [pattern, value] of Object.entries(exportsMap)) {
  if (typeof value === 'string') {
    checkTarget(pattern, value);
  } else if (value && typeof value === 'object') {
    for (const [condition, target] of Object.entries(value)) {
      if (typeof target === 'string') checkTarget(`${pattern} (${condition})`, target);
    }
  }
}

if (errors.length > 0) {
  console.error('check:exports FAILED:');
  for (const e of errors) console.error('  -', e);
  process.exit(1);
}
console.log(`check:exports OK (${Object.keys(exportsMap).length} patterns checked)`);
