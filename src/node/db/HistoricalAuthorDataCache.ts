// Per-pad cache for the `{authorId -> {name, colorId}}` map used by
// PadMessageHandler.handleClientReady to populate clientVars
// (#7756 connect-handshake investigation).
//
// At 200+ authors a burst of 50 simultaneous CLIENT_READY handshakes
// would otherwise each do Promise.all(authors.map(getAuthor)) =
// 50 * 200 = 10 000 ueberdb cache lookups inside the join hot path,
// competing for the event loop. This cache collapses that to one
// computation shared across the simultaneous joins.
//
// Extracted into its own module (rather than nested inside Pad) so it can
// be unit-tested without standing up the full pad / DB stack.

export type AuthorRecord = {name: string; colorId: string};
export type GetAuthorFn = (id: string) => Promise<AuthorRecord | null | undefined>;
export type OnMissingAuthorFn = (id: string) => void;

type CacheState = {
  /** Resolved data. Empty `{}` until the first compute() resolves. */
  data: {[id: string]: AuthorRecord};
  /** Set iff a compute() is currently in flight. New callers await this same
   *  promise rather than starting a duplicate compute. Cleared on resolve. */
  promise?: Promise<{[id: string]: AuthorRecord}>;
  /** Wall-clock time the current data was committed. Used for TTL only. */
  builtAt: number;
};

export class HistoricalAuthorDataCache {
  private state: CacheState | null = null;

  constructor(
    private readonly listAuthorIds: () => string[],
    private readonly getAuthor: GetAuthorFn,
    private readonly ttlMs: number = 5_000,
    private readonly now: () => number = Date.now,
    /** Called once per author id that the fetcher returns falsy for.
     *  Lets the consumer preserve the error log that lived in the
     *  previous inline Promise.all loop. Optional. */
    private readonly onMissingAuthor: OnMissingAuthorFn = () => {},
  ) {}

  async get(): Promise<{[id: string]: AuthorRecord}> {
    const now = this.now();
    const s = this.state;
    // In-flight compute: piggyback on it regardless of TTL — never start a
    // second compute on top of a running one. The previous version could
    // race two computes if the first ran past ttlMs, and the older
    // resolution would clobber the newer cached value.
    if (s?.promise) return cloneData(await s.promise);
    if (s && now - s.builtAt < this.ttlMs) return cloneData(s.data);
    return cloneData(await this.refresh(now));
  }

  /** Force the next get() to refetch. PadMessageHandler can call this when
   *  a new author commits, if we add hookable author-add events later. */
  invalidate(): void { this.state = null; }

  private refresh(now: number): Promise<{[id: string]: AuthorRecord}> {
    const promise = this.compute();
    this.state = {data: {}, promise, builtAt: now};
    promise.then(
      (data) => {
        // Only commit if our promise is still the one the state references —
        // covers the (unlikely) case where invalidate() ran during compute.
        if (this.state?.promise === promise) {
          this.state = {data, builtAt: this.now()};
        }
      },
      () => { if (this.state?.promise === promise) this.state = null; },
    );
    return promise;
  }

  private async compute(): Promise<{[id: string]: AuthorRecord}> {
    const ids = this.listAuthorIds();
    const out: {[id: string]: AuthorRecord} = {};
    await Promise.all(ids.map(async (id) => {
      const a = await this.getAuthor(id);
      if (a) out[id] = {name: a.name, colorId: a.colorId};
      else this.onMissingAuthor(id);
    }));
    return out;
  }
}

// Defensive shallow copy on every get(). Callers (notably handleClientReady,
// which embeds the result in clientVars and exposes it to the clientVars
// hook) historically received a fresh object per call; preserving that
// here so a mutation by one join can't bleed into the next.
const cloneData = (
  src: {[id: string]: AuthorRecord},
): {[id: string]: AuthorRecord} => {
  const out: {[id: string]: AuthorRecord} = {};
  for (const k in src) out[k] = {name: src[k]!.name, colorId: src[k]!.colorId};
  return out;
};
