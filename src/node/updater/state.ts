import fs from 'node:fs/promises';
import path from 'node:path';
import {EMPTY_STATE, UpdateState} from './types';

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

const isStringOrNull = (v: unknown): v is string | null =>
  v === null || typeof v === 'string';

const isValidLatest = (v: unknown): boolean => {
  if (v === null) return true;
  if (!isPlainObject(v)) return false;
  // Subfields are read into semver parsing and email rendering; if any is
  // missing or wrong-type the file is treated as corrupt and reset.
  return typeof v.version === 'string'
    && typeof v.tag === 'string'
    && typeof v.body === 'string'
    && typeof v.publishedAt === 'string'
    && typeof v.htmlUrl === 'string'
    && typeof v.prerelease === 'boolean';
};

const isValidVulnerableBelow = (v: unknown): boolean => {
  if (!Array.isArray(v)) return false;
  return v.every((entry) =>
    isPlainObject(entry)
    && typeof entry.announcedBy === 'string'
    && typeof entry.threshold === 'string');
};

const isValidEmail = (v: unknown): boolean => {
  if (!isPlainObject(v)) return false;
  return isStringOrNull(v.severeAt)
    && isStringOrNull(v.vulnerableAt)
    && isStringOrNull(v.vulnerableNewReleaseTag);
};

// Validate the full shape so loadState() actually delivers on its "safely
// reset on malformed input" contract. Downstream code calls .trim() / semver
// parsing on these subfields and would crash on a hand-edited file otherwise.
const isValid = (raw: unknown): raw is UpdateState => {
  if (!isPlainObject(raw)) return false;
  return raw.schemaVersion === 1
    && isStringOrNull(raw.lastCheckAt)
    && isStringOrNull(raw.lastEtag)
    && isValidLatest(raw.latest)
    && isValidVulnerableBelow(raw.vulnerableBelow)
    && isValidEmail(raw.email);
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
