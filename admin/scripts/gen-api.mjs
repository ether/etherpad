// admin/scripts/gen-api.mjs
//
// Regenerates admin/src/api/schema.d.ts from the live OpenAPI spec exported
// by src/node/hooks/express/openapi.ts. Run via `pnpm --filter admin gen:api`.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const adminRoot = path.resolve(here, '..');
const outFile = path.join(adminRoot, 'src', 'api', 'schema.d.ts');

const tmpDir = mkdtempSync(path.join(tmpdir(), 'etherpad-openapi-'));
const specPath = path.join(tmpDir, 'spec.json');

// On Windows pnpm resolves to pnpm.cmd, which spawnSync can only find via a
// shell. Use shell on Windows only to avoid Node's DEP0190 warning elsewhere.
// Every argument here is fixed (no user input) so the shell:true variant is
// not an injection risk.
const spawnOpts = {
  cwd: adminRoot,
  stdio: 'inherit',
  shell: process.platform === 'win32',
};

try {
  const dump = spawnSync(
    'pnpm',
    ['exec', 'tsx', 'scripts/dump-spec.ts', specPath],
    spawnOpts,
  );
  if (dump.status !== 0) {
    console.error(`dump-spec.ts failed with exit code ${dump.status}`);
    process.exit(dump.status ?? 1);
  }

  const gen = spawnSync(
    'pnpm',
    ['exec', 'openapi-typescript', specPath, '-o', outFile],
    spawnOpts,
  );
  if (gen.status !== 0) {
    console.error(`openapi-typescript failed with exit code ${gen.status}`);
    process.exit(gen.status ?? 1);
  }

  const header =
    `// GENERATED — do not edit. Run \`pnpm --filter admin gen:api\` to regenerate.\n` +
    `// Source: src/node/hooks/express/openapi.ts (#7638)\n\n`;
  const body = readFileSync(outFile, 'utf8');
  writeFileSync(outFile, header + body, 'utf8');

  // Emit a runtime-side version constant so client.ts can build the right
  // baseUrl. Generated paths are unprefixed (e.g. "/createGroup"), but the
  // backend mounts the FLAT-style spec under /api/<version>/.
  const spec = JSON.parse(readFileSync(specPath, 'utf8'));
  const apiVersion = spec?.info?.version;
  if (typeof apiVersion !== 'string' || apiVersion.length === 0) {
    console.error('OpenAPI spec is missing info.version; cannot emit version.ts');
    process.exit(1);
  }
  const versionFile = path.join(adminRoot, 'src', 'api', 'version.ts');
  writeFileSync(
    versionFile,
    header +
      `export const LATEST_API_VERSION = ${JSON.stringify(apiVersion)};\n` +
      `export const API_BASE_URL = \`/api/\${LATEST_API_VERSION}\`;\n`,
    'utf8',
  );

  console.log(`Wrote ${path.relative(process.cwd(), outFile)}`);
  console.log(`Wrote ${path.relative(process.cwd(), versionFile)}`);
} finally {
  rmSync(tmpDir, { recursive: true, force: true });
}
