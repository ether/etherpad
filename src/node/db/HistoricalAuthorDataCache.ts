// Per-pad cache for the `{authorId -> {name, colorId}}` map used by
// PadMessageHandler.handleClientReady to populate clientVars
// (#7756 connect-handshake cliff investigation).
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

export class HistoricalAuthorDataCache {
  private cached: AuthorRecord extends never ? never : {
    data: {[id: string]: AuthorRecord};
    promise?: Promise<{[id: string]: AuthorRecord}>;
    builtAt: number;
  } | null = null;

  constructor(
    private readonly listAuthorIds: () => string[],
    private readonly getAuthor: GetAuthorFn,
    private readonly ttlMs: number = 5_000,
    private readonly now: () => number = Date.now,
  ) {}

  async get(): Promise<{[id: string]: AuthorRecord}> {
    const now = this.now();
    const cached = this.cached;
    if (cached && now - cached.builtAt < this.ttlMs) {
      return cached.promise ?? cached.data;
    }
    const promise = this.compute();
    this.cached = {data: {}, promise, builtAt: now};
    try {
      const data = await promise;
      this.cached = {data, builtAt: now};
      return data;
    } catch (err) {
      this.cached = null;
      throw err;
    }
  }

  /** Force the next get() to refetch. PadMessageHandler can call this when
   *  a new author commits, if we add hookable author-add events later. */
  invalidate(): void { this.cached = null; }

  private async compute(): Promise<{[id: string]: AuthorRecord}> {
    const ids = this.listAuthorIds();
    const out: {[id: string]: AuthorRecord} = {};
    await Promise.all(ids.map(async (id) => {
      const a = await this.getAuthor(id);
      if (a) out[id] = {name: a.name, colorId: a.colorId};
    }));
    return out;
  }
}
