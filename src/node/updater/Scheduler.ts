import {EmailSendLog, ExecutionStatus, PolicyResult, ReleaseInfo, UpdateState} from './types.js';
import {PlannedEmail} from './Notifier.js';

export interface DecideScheduleInput {
  state: UpdateState;
  now: Date;
  policy: PolicyResult;
  latest: ReleaseInfo | null;
  current: string;
  preApplyGraceMinutes: number;
  adminEmail: string | null;
}

export type SchedulerDecision =
  | {action: 'nothing'}
  | {
      action: 'schedule';
      newExecution: Extract<ExecutionStatus, {status: 'scheduled'}>;
      emails: PlannedEmail[];
      newEmailState: EmailSendLog;
    }
  | {action: 'cancel-schedule'; reason: string};

const IN_FLIGHT: ReadonlySet<string> = new Set([
  'preflight', 'draining', 'executing', 'pending-verification', 'rolling-back',
]);
const TERMINAL: ReadonlySet<string> = new Set([
  'preflight-failed', 'rolled-back', 'rollback-failed',
]);
const MAX_GRACE_MINUTES = 7 * 24 * 60;

const clampGrace = (m: number): number => {
  if (!Number.isFinite(m) || m <= 0) return 0;
  return Math.min(MAX_GRACE_MINUTES, Math.floor(m));
};

/**
 * Pure scheduler decision. Returns what the runner should do given the current
 * persisted state, the latest known release, and the resolved policy. No I/O.
 *
 * Decision rules (mirrors design spec § "Tier 3 — auto"):
 *  - No latest, or canAuto false and not currently scheduled → nothing.
 *  - canAuto false but state is scheduled → cancel that schedule (tier flipped).
 *  - State is in-flight or terminal → nothing (let manual/rollback complete).
 *  - State is scheduled for the current latest tag → nothing (timer is armed).
 *  - State is scheduled for a stale tag, or any other allowed entry status →
 *    schedule for `now + clamp(preApplyGraceMinutes)`. Emit a `grace-start`
 *    email when `adminEmail` is set and `email.graceStartTag !== latest.tag`.
 */
export const decideSchedule = (input: DecideScheduleInput): SchedulerDecision => {
  const {state, now, policy, latest, current, preApplyGraceMinutes, adminEmail} = input;
  const status = state.execution.status;

  if (!latest) return {action: 'nothing'};

  if (!policy.canAuto) {
    if (status === 'scheduled') return {action: 'cancel-schedule', reason: 'policy-denied'};
    return {action: 'nothing'};
  }

  if (IN_FLIGHT.has(status) || TERMINAL.has(status)) return {action: 'nothing'};

  if (status === 'scheduled'
      && (state.execution as {targetTag: string}).targetTag === latest.tag) {
    return {action: 'nothing'};
  }

  const graceMs = clampGrace(preApplyGraceMinutes) * 60 * 1000;
  const scheduledFor = new Date(now.getTime() + graceMs).toISOString();
  const newExecution = {
    status: 'scheduled' as const,
    targetTag: latest.tag,
    scheduledFor,
    startedAt: now.toISOString(),
  };

  const emails: PlannedEmail[] = [];
  const newEmailState: EmailSendLog = {...state.email};
  if (adminEmail && state.email.graceStartTag !== latest.tag) {
    emails.push({
      kind: 'grace-start',
      subject: `[Etherpad] Auto-update scheduled for ${latest.version}`,
      body: `Etherpad will auto-update to ${latest.tag} at ${scheduledFor}. ` +
            `Your version is ${current}. To cancel, visit /admin/update.`,
    });
    newEmailState.graceStartTag = latest.tag;
  }

  return {action: 'schedule', newExecution, emails, newEmailState};
};

export type TriggerApplyDecision =
  | {action: 'fire'}
  | {action: 'abort'; reason: string}
  | {action: 'clear-schedule'; reason: string};

/**
 * Decide whether the scheduler's timer-fire callback should actually run the
 * apply pipeline. Pure — no I/O. The runner re-checks at fire time because
 * arming-to-firing has a long delay (the grace window) during which the
 * admin can cancel, click Apply now, or flip the tier. SchedulerRunnerDeps
 * documents this contract; this helper is the canonical implementation.
 */
export const decideTriggerApply = ({
  state, targetTag, policy,
}: {state: UpdateState; targetTag: string; policy: PolicyResult}): TriggerApplyDecision => {
  if (state.execution.status !== 'scheduled') {
    return {action: 'abort', reason: `state=${state.execution.status}`};
  }
  if ((state.execution as {targetTag: string}).targetTag !== targetTag) {
    return {action: 'abort', reason: `tag=${(state.execution as {targetTag: string}).targetTag}`};
  }
  if (!state.latest) return {action: 'abort', reason: 'no-latest'};
  if (!policy.canAuto) return {action: 'clear-schedule', reason: policy.reason || 'policy-denied'};
  return {action: 'fire'};
};

export interface SchedulerRunnerDeps {
  now: () => Date;
  setTimer: (cb: () => void, ms: number) => NodeJS.Timeout;
  clearTimer: (h: NodeJS.Timeout) => void;
  /**
   * Invoked when the timer fires. Should re-check persisted state before
   * acting — the runner guarantees one fire per arm() call, but does not
   * coordinate with state changes that happen between arm() and fire.
   */
  triggerApply: (targetTag: string) => Promise<void>;
}

export interface SchedulerRunner {
  /** Arm or re-arm the timer for `scheduledFor`. Idempotent: re-arming clears prior. */
  arm: (s: {targetTag: string; scheduledFor: string}) => void;
  /** Cancel a pending timer. Idempotent; no-op after the timer has fired. */
  cancel: () => void;
}

export const createSchedulerRunner = ({
  now, setTimer, clearTimer, triggerApply,
}: SchedulerRunnerDeps): SchedulerRunner => {
  let timer: NodeJS.Timeout | null = null;
  let armedFor: string | null = null;

  return {
    arm: ({targetTag, scheduledFor}) => {
      if (timer) { clearTimer(timer); timer = null; }
      armedFor = targetTag;
      const delay = Math.max(0, new Date(scheduledFor).getTime() - now().getTime());
      timer = setTimer(() => {
        timer = null;
        const tag = armedFor;
        armedFor = null;
        if (!tag) return;
        // Discard promise — apply pipeline owns its own error reporting.
        void triggerApply(tag);
      }, delay);
    },
    cancel: () => {
      if (timer) { clearTimer(timer); timer = null; }
      armedFor = null;
    },
  };
};
