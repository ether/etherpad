import fs from 'node:fs/promises';
import path from 'node:path';
import {EMPTY_STATE, UpdateState} from './types';

export {EMPTY_STATE as EMPTY_STATE_FOR_TESTS};

const isValid = (raw: unknown): raw is UpdateState => {
  if (!raw || typeof raw !== 'object') return false;
  const o = raw as Record<string, unknown>;
  return o.schemaVersion === 1
    && (o.lastCheckAt === null || typeof o.lastCheckAt === 'string')
    && (o.lastEtag === null || typeof o.lastEtag === 'string')
    && (o.latest === null || typeof o.latest === 'object')
    && Array.isArray(o.vulnerableBelow)
    && typeof o.email === 'object';
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
