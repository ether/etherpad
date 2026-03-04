'use strict';

/**
 * Wrapper around any iterable that adds convenience methods that standard JavaScript iterable
 * objects lack.
 */
class Stream {
  private _iter
  private _next: any
  /**
   * @returns {Stream} A Stream that yields values in the half-open range [start, end).
   */
  static range(start: number, end: number) {
    return new Stream((function* () { for (let i = start; i < end; ++i) yield i; })());
  }

  /**
   * @param {Iterable<any>} values - Any iterable of values.
   */
  constructor(values: Iterable<any>) {
    this._iter = values[Symbol.iterator]();
    this._next = null;
  }

  /**
   * Read values a chunk at a time from the underlying iterable. Once a full batch is read (or there
   * aren't enough values to make a full batch), all of the batch's values are yielded before the
   * next batch is read.
   *
   * This is useful for triggering groups of asynchronous tasks via Promises yielded from a
   * synchronous generator. A for-await-of (or for-of with an await) loop consumes those Promises
   * and automatically triggers the next batch of tasks when needed. For example:
   *
   *     const resources = (function* () {
   *       for (let i = 0; i < 100; ++i) yield fetchResource(i);
   *     }).call(this);
   *
   *     // Fetch 10 items at a time so that the fetch engine can bundle multiple requests into a
   *     // single query message.
   *     for await (const r of new Stream(resources).batch(10)) {
   *       processResource(r);
   *     }
   *
   * Chaining .buffer() after .batch() like stream.batch(n).buffer(m) will fetch in batches of n as
   * needed to ensure that at least m are in flight at all times.
   *
   * Any Promise yielded by the underlying iterable has its rejection suppressed to prevent
   * unhandled rejection errors while the Promise is sitting in the batch waiting to be yielded. It
   * is assumed that the consumer of any yielded Promises will await the Promise (or call .catch()
   * or .then()) to prevent the rejection from going unnoticed. If iteration is aborted early, any
   * Promises read from the underlying iterable that have not yet been yielded will have their
   * rejections un-suppressed to trigger unhandled rejection errors.
   *
   * @param {number} size - The number of values to read at a time.
   * @returns {Stream} A new Stream that gets its values from this Stream.
   */
  batch(size: number) {
    return new Stream((function* () {
      const b = [];
      try {
        // @ts-ignore
        for (const v of this) {
          Promise.resolve(v).catch(() => {}); // Suppress unhandled rejection errors.
          b.push(v);
          if (b.length < size) continue;
          while (b.length) yield b.shift();
        }
        while (b.length) yield b.shift();
      } finally {
        for (const v of b) Promise.resolve(v).then(() => {}); // Un-suppress unhandled rejections.
      }
    }).call(this));
  }

  /**
   * Pre-fetch a certain number of values from the underlying iterable before yielding the first
   * value. Each time a value is yielded (consumed from the buffer), another value is read from the
   * underlying iterable and added to the buffer.
   *
   * This is useful for maintaining a constant number of in-flight asynchronous tasks via Promises
   * yielded from a synchronous generator. A for-await-of (or for-of with an await) loop should be
   * used to control the scheduling of the next task. For example:
   *
   *     const resources = (function* () {
   *       for (let i = 0; i < 100; ++i) yield fetchResource(i);
   *     }).call(this);
   *
   *     // Fetching a resource is high latency, so keep multiple in flight at all times until done.
   *     for await (const r of new Stream(resources).buffer(10)) {
   *       processResource(r);
   *     }
   *
   * Chaining after .batch() like stream.batch(n).buffer(m) will fetch in batches of n as needed to
   * ensure that at least m are in flight at all times.
   *
   * Any Promise yielded by the underlying iterable has its rejection suppressed to prevent
   * unhandled rejection errors while the Promise is sitting in the batch waiting to be yielded. It
   * is assumed that the consumer of any yielded Promises will await the Promise (or call .catch()
   * or .then()) to prevent the rejection from going unnoticed. If iteration is aborted early, any
   * Promises read from the underlying iterable that have not yet been yielded will have their
   * rejections un-suppressed to trigger unhandled rejection errors.
   *
   * @param {number} capacity - The number of values to keep buffered.
   * @returns {Stream} A new Stream that gets its values from this Stream.
   */
  buffer(capacity: number) {
    return new Stream((function* () {
      const b = [];
      try {
        // @ts-ignore
        for (const v of this) {
          Promise.resolve(v).catch(() => {}); // Suppress unhandled rejection errors.
          // Note: V8 has good Array push+shift optimization.
          while (b.length >= capacity) yield b.shift();
          b.push(v);
        }
        while (b.length) yield b.shift();
      } finally {
        for (const v of b) Promise.resolve(v).then(() => {}); // Un-suppress unhandled rejections.
      }
    }).call(this));
  }

  /**
   * Like Array.map().
   *
   * @param {(v: any) => any} fn - Value transformation function.
   * @returns {Stream} A new Stream that yields this Stream's values, transformed by `fn`.
   */
  map(fn:Function) { return new Stream((function* () { // @ts-ignore
    for (const v of this) yield fn(v); }).call(this)); }

  /**
   * Implements the JavaScript iterable protocol.
   */
  [Symbol.iterator]() { return this._iter; }
}

module.exports = Stream;
