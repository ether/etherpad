// admin/scripts/dump-spec.ts
//
// Imports the public + admin OpenAPI spec builders from the etherpad
// source, merges them into one document, and writes JSON to argv[2].
// Invoked by admin/scripts/gen-api.mjs via `tsx`.
//
// Why a file argument instead of stdout: importing openapi*.ts triggers
// Settings init, which configures log4js to write INFO/WARN lines to
// stdout. Capturing stdout would mix logs with JSON.

import {writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
// @ts-expect-error — sibling .mjs has no .d.ts; tsx resolves it at runtime.
import {mergeOpenAPI} from './merge-openapi.mjs';

const outFile = process.argv[2];
if (!outFile) {
  process.stderr.write('Usage: tsx scripts/dump-spec.ts <output-path>\n');
  process.exit(2);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

const apiHandlerPath = path.join(repoRoot, 'src', 'node', 'handler', 'APIHandler.ts');
const openapiPath = path.join(repoRoot, 'src', 'node', 'hooks', 'express', 'openapi.ts');
const openapiAdminPath = path.join(
  repoRoot, 'src', 'node', 'hooks', 'express', 'openapi-admin.ts',
);

type ApiHandlerModule = {latestApiVersion: string};
type OpenApiModule = {
  generateDefinitionForVersion: (version: string, style?: string) => unknown;
  APIPathStyle: {FLAT: string; REST: string};
};
type OpenApiAdminModule = {
  generateAdminDefinition: () => unknown;
};

const apiHandlerMod = await import(pathToFileURL(apiHandlerPath).href);
const openapiMod = await import(pathToFileURL(openapiPath).href);
const openapiAdminMod = await import(pathToFileURL(openapiAdminPath).href);

const apiHandler = (apiHandlerMod.default ?? apiHandlerMod) as ApiHandlerModule;
const openapi = (openapiMod.default ?? openapiMod) as OpenApiModule;
const openapiAdmin = (openapiAdminMod.default ?? openapiAdminMod) as OpenApiAdminModule;

const publicSpec = openapi.generateDefinitionForVersion(
  apiHandler.latestApiVersion,
  openapi.APIPathStyle.FLAT,
);
const adminSpec = openapiAdmin.generateAdminDefinition();

const merged = mergeOpenAPI(publicSpec, adminSpec);

writeFileSync(path.resolve(outFile), JSON.stringify(merged, null, 2), 'utf8');
