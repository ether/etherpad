import {EmailSendLog} from './types';

// TODO(future): surface the threshold version in email bodies so admins know which version
// clears the vulnerability. Requires extending NotifierInput with the relevant directive(s).
export interface NotifierInput {
  adminEmail: string | null;
  current: string;
  latest: string;
  latestTag: string;
  isVulnerable: boolean;
  isSevere: boolean;
  state: EmailSendLog;
  now: Date;
}

export type EmailKind = 'severe' | 'vulnerable' | 'vulnerable-new-release';

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
const VULNERABLE_INTERVAL = 7 * DAY;

const sinceMs = (iso: string | null, now: Date): number =>
  iso ? now.getTime() - new Date(iso).getTime() : Infinity;

/**
 * Decide which emails to send and what the new dedupe-log state should be.
 * Pure function: returns plans + new state, does not actually send.
 *
 * Cadence: vulnerable beats severe; vulnerable repeats every 7 days; severe every 30.
 * If vulnerable AND the release tag changed since last send, fire `vulnerable-new-release`
 * even within the 7-day window so admins learn of the fixed release.
 */
export const decideEmails = (input: NotifierInput): NotifierResult => {
  const {adminEmail, current, latest, latestTag, isVulnerable, isSevere, state, now} = input;

  if (!adminEmail) return {toSend: [], newState: state};

  const toSend: PlannedEmail[] = [];
  const newState: EmailSendLog = {...state};

  if (isVulnerable) {
    const sinceVuln = sinceMs(state.vulnerableAt, now);
    const tagChanged = state.vulnerableNewReleaseTag !== null && state.vulnerableNewReleaseTag !== latestTag;
    if (tagChanged) {
      // A new release shipped while the instance is still vulnerable. Fire regardless
      // of the 7-day cadence: the admin needs to know a fix exists.
      toSend.push({
        kind: 'vulnerable-new-release',
        subject: `[Etherpad] New release available — ${latest} (your version is vulnerable)`,
        body: `A new Etherpad release (${latestTag}) is available. Your version (${current}) is flagged as vulnerable. Please update.`,
      });
      newState.vulnerableNewReleaseTag = latestTag;
      // Also reset the periodic clock so we don't immediately re-nag on next tick.
      newState.vulnerableAt = now.toISOString();
    } else if (sinceVuln >= VULNERABLE_INTERVAL) {
      toSend.push({
        kind: 'vulnerable',
        subject: `[Etherpad] Your instance is running a vulnerable version (${current})`,
        body: `Your Etherpad version (${current}) is below the security threshold. Latest is ${latest}.`,
      });
      newState.vulnerableAt = now.toISOString();
      newState.vulnerableNewReleaseTag = latestTag;
    }
  } else if (isSevere) {
    const sinceSevere = sinceMs(state.severeAt, now);
    if (sinceSevere >= SEVERE_INTERVAL) {
      toSend.push({
        kind: 'severe',
        subject: `[Etherpad] Your instance is severely outdated (${current})`,
        body: `Your Etherpad version (${current}) is more than one major release behind ${latest}.`,
      });
      newState.severeAt = now.toISOString();
    }
  }

  return {toSend, newState};
};
