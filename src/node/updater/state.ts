import fs from 'node:fs/promises';
import path from 'node:path';
import {EMPTY_STATE, UpdateState} from './types';

export {EMPTY_STATE as EMPTY_STATE_FOR_TESTS};

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

// NOTE: We validate top-level shape only. Subfields of `email` and `latest` are
// trusted because EMPTY_STATE always provides them and only this module writes the file.
// If a future consumer hand-edits the file, malformed subfields will surface at use site.
const isValid = (raw: unknown): raw is UpdateState => {
  if (!isPlainObject(raw)) return false;
  return raw.schemaVersion === 1
    && (raw.lastCheckAt === null || typeof raw.lastCheckAt === 'string')
    && (raw.lastEtag === null || typeof raw.lastEtag === 'string')
    && (raw.latest === null || isPlainObject(raw.latest))
    && Array.isArray(raw.vulnerableBelow)
    && isPlainObject(raw.email);
};

/** Reads the on-disk state. Returns a fresh empty-state clone when the file is missing, malformed, or has an unknown schemaVersion. Never throws on parse errors. */
export const loadState = async (filePath: string): Promise<UpdateState> => {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch (err: any) {
    if (err.code === 'ENOENT') return structuredClone(EMPTY_STATE);
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return structuredClone(EMPTY_STATE);
  }
  if (!isValid(parsed)) return structuredClone(EMPTY_STATE);
  return parsed;
};

/** Atomic write via tmp-then-rename. Creates parent directories as needed. */
export const saveState = async (filePath: string, state: UpdateState): Promise<void> => {
  await fs.mkdir(path.dirname(filePath), {recursive: true});
  const tmp = `${filePath}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(state, null, 2));
  await fs.rename(tmp, filePath);
};
