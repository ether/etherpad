// Wire-format decision for NEW_CHANGES vs NEW_CHANGES_BATCH (#7756 lever 3b).
//
// Lives in its own tiny module rather than inside PadMessageHandler so the
// pure decision can be unit-tested without standing up the full pad / DB /
// socket.io stack. PadMessageHandler.updatePadClients calls this function
// once per recipient with the queued revisions for that recipient.

export type NewChangesItem = {
  newRev: number;
  changeset: string;
  apool: unknown;
  author: string;
  currentTime: number;
  timeDelta: number;
};

export type NewChangesEmit =
  | {type: 'COLLABROOM'; data: {type: 'NEW_CHANGES'} & NewChangesItem}
  | {type: 'COLLABROOM'; data: {type: 'NEW_CHANGES_BATCH'; changes: NewChangesItem[]}};

/**
 * Decide what to put on the wire for one recipient.
 * - No queued revisions: nothing.
 * - Batching disabled, or exactly one rev: emit one NEW_CHANGES per rev
 *   (legacy behaviour; preserves bytes-on-wire for the steady state).
 * - Batching enabled and multiple revs: emit one NEW_CHANGES_BATCH with
 *   the array of revisions.
 */
export const buildNewChangesEmits = (
  pending: NewChangesItem[],
  batchEnabled: boolean,
): NewChangesEmit[] => {
  if (pending.length === 0) return [];
  if (batchEnabled && pending.length > 1) {
    return [{type: 'COLLABROOM', data: {type: 'NEW_CHANGES_BATCH', changes: pending}}];
  }
  return pending.map((change) => ({
    type: 'COLLABROOM',
    data: {type: 'NEW_CHANGES', ...change},
  } as NewChangesEmit));
};
