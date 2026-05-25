import fs from 'node:fs/promises';
import path from 'node:path';
import {EMPTY_STATE, EXECUTION_STATUSES, UpdateState} from './types.js';

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

const isStringOrNull = (v: unknown): v is string | null =>
  v === null || typeof v === 'string';

// Per-status field requirements that mirror the ExecutionStatus union in types.ts.
// Persisted-state corruption (a hand-edited file or a future schema bump that
// missed a migration) must never reach RollbackHandler with `undefined` refs —
// loadState resets to EMPTY_STATE when any required field is missing.
const EXEC_REQUIRED_FIELDS: Record<string, readonly string[]> = {
  'idle': [],
  'scheduled': ['targetTag', 'scheduledFor', 'startedAt'],
  'preflight': ['targetTag', 'startedAt'],
  'preflight-failed': ['targetTag', 'reason', 'at'],
  'draining': ['targetTag', 'drainEndsAt', 'startedAt'],
  'executing': ['targetTag', 'fromSha', 'startedAt'],
  'pending-verification': ['targetTag', 'fromSha', 'deadlineAt'],
  'verified': ['targetTag', 'verifiedAt'],
  'rolling-back': ['reason', 'targetTag', 'fromSha', 'at'],
  'rolled-back': ['reason', 'targetTag', 'restoredSha', 'at'],
  'rollback-failed': ['reason', 'targetTag', 'fromSha', 'at'],
};

// Fields that must parse as valid timestamps. The Scheduler computes its delay
// via `new Date(scheduledFor).getTime()`; an invalid string would yield NaN
// and effectively fire the timer immediately. Defence-in-depth against a
// hand-edited update-state.json (Qodo #4).
const EXEC_TIMESTAMP_FIELDS: ReadonlySet<string> = new Set([
  'scheduledFor', 'startedAt', 'drainEndsAt', 'deadlineAt', 'verifiedAt', 'at',
]);

const isValidExecution = (v: unknown): boolean => {
  if (!isPlainObject(v)) return false;
  if (typeof v.status !== 'string') return false;
  if (!(EXECUTION_STATUSES as readonly string[]).includes(v.status)) return false;
  const required = EXEC_REQUIRED_FIELDS[v.status];
  if (!required) return false; // unknown status — fail closed
  for (const field of required) {
    const value = (v as Record<string, unknown>)[field];
    if (typeof value !== 'string') return false;
    if (value.length === 0) return false;
    if (EXEC_TIMESTAMP_FIELDS.has(field) && Number.isNaN(Date.parse(value))) return false;
  }
  return true;
};

// Outcomes that LastUpdateResult.outcome must match.
const VALID_OUTCOMES: ReadonlySet<string> = new Set([
  'verified', 'rolled-back', 'rollback-failed', 'preflight-failed', 'cancelled',
]);

const isValidLastResult = (v: unknown): boolean => {
  if (v === null) return true;
  if (!isPlainObject(v)) return false;
  return typeof v.targetTag === 'string'
    && typeof v.fromSha === 'string'
    && typeof v.outcome === 'string'
    && VALID_OUTCOMES.has(v.outcome)
    && (v.reason === null || typeof v.reason === 'string')
    && typeof v.at === 'string';
};

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

const isValidEmail = (v: unknown): boolean => {
  if (!isPlainObject(v)) return false;
  // graceStartTag (Tier 3) and lastFailureKey (Tier 4) are both optional for
  // backwards compatibility with state files written by earlier installs;
  // loadState backfills missing fields to null. If present, must be string|null.
  const graceOk = v.graceStartTag === undefined || isStringOrNull(v.graceStartTag);
  const failOk = v.lastFailureKey === undefined || isStringOrNull(v.lastFailureKey);
  return isStringOrNull(v.severeAt)
    && graceOk
    && failOk;
};

// Validate the full shape so loadState() actually delivers on its "safely
// reset on malformed input" contract. Downstream code calls .trim() / semver
// parsing on these subfields and would crash on a hand-edited file otherwise.
//
// Tier 2 fields (execution, bootCount, lastResult) MAY be absent on a state
// file written by a Tier 1 install — those are backfilled at load time.
// Present-but-malformed values still reject so a hand-edited file with
// e.g. execution.status="totally-bogus" can't poison RollbackHandler.
const isValid = (raw: unknown): raw is Partial<UpdateState> & object => {
  if (!isPlainObject(raw)) return false;
  if (raw.schemaVersion !== 1) return false;
  if (!isStringOrNull(raw.lastCheckAt)) return false;
  if (!isStringOrNull(raw.lastEtag)) return false;
  if (!isValidLatest(raw.latest)) return false;
  if (!isValidEmail(raw.email)) return false;
  if (raw.execution !== undefined && !isValidExecution(raw.execution)) return false;
  if (raw.bootCount !== undefined && typeof raw.bootCount !== 'number') return false;
  if (raw.lastResult !== undefined && !isValidLastResult(raw.lastResult)) return false;
  return true;
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
  // Backfill Tier 2 / Tier 3 fields on a legacy state file. Spread defaults
  // first, parsed second so explicit values win, then explicit fallback for
  // the fields that might be undefined. email.graceStartTag is backfilled
  // separately because email validator allows it to be absent.
  const partial = parsed as Partial<UpdateState>;
  const email = partial.email ?? structuredClone(EMPTY_STATE.email);
  return {
    ...structuredClone(EMPTY_STATE),
    ...partial,
    email: {
      ...email,
      graceStartTag: email.graceStartTag ?? null,
      lastFailureKey: email.lastFailureKey ?? null,
    },
    execution: partial.execution ?? structuredClone(EMPTY_STATE.execution),
    bootCount: partial.bootCount ?? 0,
    lastResult: partial.lastResult ?? null,
  } as UpdateState;
};

/** Atomic write via tmp-then-rename. Creates parent directories as needed. */
export const saveState = async (filePath: string, state: UpdateState): Promise<void> => {
  await fs.mkdir(path.dirname(filePath), {recursive: true});
  const tmp = `${filePath}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(state, null, 2));
  await fs.rename(tmp, filePath);
};
