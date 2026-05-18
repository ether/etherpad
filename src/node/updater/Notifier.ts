import {EmailSendLog} from './types';

export interface NotifierInput {
  adminEmail: string | null;
  current: string;
  latest: string;
  latestTag: string;
  isSevere: boolean;
  state: EmailSendLog;
  now: Date;
}

export type EmailKind =
  | 'severe'
  | 'grace-start'
  | 'update-preflight-failed'
  | 'update-rolled-back'
  | 'update-rollback-failed';

export interface PlannedEmail {
  kind: EmailKind;
  subject: string;
  body: string;
}

export interface NotifierResult {
  toSend: PlannedEmail[];
  newState: EmailSendLog;
}

const DAY = 24 * 60 * 60 * 1000;
const SEVERE_INTERVAL = 30 * DAY;

const sinceMs = (iso: string | null, now: Date): number =>
  iso ? now.getTime() - new Date(iso).getTime() : Infinity;

/**
 * Decide which emails to send and what the new dedupe-log state should be.
 * Pure function: returns plans + new state, does not actually send.
 *
 * Cadence: severe repeats every 30 days.
 */
export const decideEmails = (input: NotifierInput): NotifierResult => {
  const {adminEmail, current, latest, isSevere, state, now} = input;

  if (!adminEmail) return {toSend: [], newState: state};

  const toSend: PlannedEmail[] = [];
  const newState: EmailSendLog = {...state};

  if (isSevere) {
    const sinceSevere = sinceMs(state.severeAt, now);
    if (sinceSevere >= SEVERE_INTERVAL) {
      toSend.push({
        kind: 'severe',
        subject: `[Etherpad] Your instance is outdated (${current})`,
        body: `Your Etherpad version (${current}) is at least one minor release behind the latest published version (${latest}). Consider scheduling an upgrade.`,
      });
      newState.severeAt = now.toISOString();
    }
  }

  return {toSend, newState};
};

export type FailureOutcome =
  | 'preflight-failed'
  | 'rolled-back'
  | 'rollback-failed';

export interface OutcomeEmailInput {
  adminEmail: string | null;
  outcome: FailureOutcome;
  /** Free-text reason string from `ApplyResult.reason` (or RollbackHandler). */
  reason: string;
  /** Tag the failed apply was targeting. */
  targetTag: string;
  /** Currently-running Etherpad version (so the admin sees what's live now). */
  currentVersion: string;
  /** Email-state slice from UpdateState. */
  state: EmailSendLog;
}

/**
 * Decide whether to email about a non-success apply outcome. Pure — returns
 * the planned email + new dedupe state; does not send.
 *
 * Dedupe key: `<outcome>:<targetTag>`. Same outcome on the same tag (e.g.
 * a retry loop that keeps failing `pnpm install` for v2.7.6) emits one
 * email. A different outcome OR a different tag resets the dedupe key and
 * fires a new email.
 *
 * `rollback-failed` always fires (overrides dedupe) — it's the terminal
 * state that needs human intervention and the admin must learn about it
 * even if a previous transient failure happened to share its key.
 */
export const decideOutcomeEmail = (input: OutcomeEmailInput): NotifierResult => {
  const {adminEmail, outcome, reason, targetTag, currentVersion, state} = input;
  if (!adminEmail) return {toSend: [], newState: state};

  const key = `${outcome}:${targetTag}`;
  const isTerminal = outcome === 'rollback-failed';
  if (!isTerminal && state.lastFailureKey === key) {
    return {toSend: [], newState: state};
  }

  const kind: EmailKind =
      outcome === 'preflight-failed' ? 'update-preflight-failed'
    : outcome === 'rolled-back' ? 'update-rolled-back'
    : 'update-rollback-failed';

  const titleByKind: Record<typeof kind, string> = {
    'update-preflight-failed':
      `[Etherpad] Auto-update to ${targetTag} blocked at preflight`,
    'update-rolled-back':
      `[Etherpad] Auto-update to ${targetTag} rolled back`,
    'update-rollback-failed':
      `[Etherpad] Auto-update FAILED and could not be rolled back — manual intervention required`,
  };

  const bodyTail = isTerminal
    ? ' Visit /admin/update and POST /admin/update/acknowledge after restoring a working install.'
    : ' Visit /admin/update for details.';

  const body =
      `Etherpad attempted to auto-update to ${targetTag} but failed: ${reason}.\n` +
      `The running version is ${currentVersion}.${bodyTail}`;

  return {
    toSend: [{kind, subject: titleByKind[kind], body}],
    newState: {...state, lastFailureKey: key},
  };
};
