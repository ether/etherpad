import type {UpdateState} from './types';

export interface StateCacheDeps {
  load: () => Promise<UpdateState>;
  save: (state: UpdateState) => Promise<void>;
}

export interface StateCache {
  /** Current state, loaded from disk on the first call. */
  get: () => Promise<UpdateState>;
  /** Persist `state` and make it the cached copy. */
  save: (state: UpdateState) => Promise<void>;
}

/**
 * The updater holds the state in memory between checks but writes it from
 * several places (apply pipeline, rollback handler, scheduler). A write that
 * did not update the cache is how a freshly written `verified` status was
 * overwritten by the next check with the stale `pending-verification` copy
 * (#8412). Both directions go through here so they cannot drift apart.
 */
export const createStateCache = (deps: StateCacheDeps): StateCache => {
  let cached: UpdateState | null = null;
  return {
    get: async () => {
      if (cached) return cached;
      cached = await deps.load();
      return cached;
    },
    save: async (state) => {
      cached = state;
      await deps.save(state);
    },
  };
};
