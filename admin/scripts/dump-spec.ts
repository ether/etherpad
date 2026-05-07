// admin/scripts/dump-spec.ts
//
// Imports the OpenAPI spec builder from the etherpad source and writes the
// flat-style spec for the latest API version as JSON to the file path passed
// as argv[2]. Invoked by admin/scripts/gen-api.mjs via `tsx`.
//
// Why a file argument instead of stdout: importing `openapi.ts` triggers
// `Settings` init, which configures log4js to write INFO/WARN lines to
// stdout. Capturing stdout would mix logs with JSON.

import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const outFile = process.argv[2];
if (!outFile) {
  process.stderr.write('Usage: tsx scripts/dump-spec.ts <output-path>\n');
  process.exit(2);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

const apiHandlerPath = path.join(repoRoot, 'src', 'node', 'handler', 'APIHandler.ts');
const openapiPath = path.join(repoRoot, 'src', 'node', 'hooks', 'express', 'openapi.ts');

// `openapi.ts` and `APIHandler.ts` use CommonJS-style `exports.*`. Under tsx's
// ESM dynamic import, the whole `module.exports` is exposed as `default`.
type ApiHandlerModule = { latestApiVersion: string };
type OpenApiModule = {
  generateDefinitionForVersion: (version: string, style?: string) => unknown;
  APIPathStyle: { FLAT: string; REST: string };
};

const apiHandlerMod = await import(pathToFileURL(apiHandlerPath).href);
const openapiMod = await import(pathToFileURL(openapiPath).href);

const apiHandler = (apiHandlerMod.default ?? apiHandlerMod) as ApiHandlerModule;
const openapi = (openapiMod.default ?? openapiMod) as OpenApiModule;

const spec = openapi.generateDefinitionForVersion(
  apiHandler.latestApiVersion,
  openapi.APIPathStyle.FLAT,
);

writeFileSync(path.resolve(outFile), JSON.stringify(spec, null, 2), 'utf8');
