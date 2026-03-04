'use strict';

const Stream = require('../../../node/utils/Stream');
import {strict} from "assert";

class DemoIterable {
  private value: number;
    errs: Error[];
    rets: any[];
  constructor() {
    this.value = 0;
    this.errs = [];
    this.rets = [];
  }

  completed() { return this.errs.length > 0 || this.rets.length > 0; }

  next() {
    if (this.completed()) return {value: undefined, done: true}; // Mimic standard generators.
    return {value: this.value++, done: false};
  }

  throw(err: any) {
    const alreadyCompleted = this.completed();
    this.errs.push(err);
    if (alreadyCompleted) throw err; // Mimic standard generator objects.
    throw err;
  }

  return(ret: number) {
    const alreadyCompleted = this.completed();
    this.rets.push(ret);
    if (alreadyCompleted) return {value: ret, done: true}; // Mimic standard generator objects.
    return {value: ret, done: true};
  }

  [Symbol.iterator]() { return this; }
}

const assertUnhandledRejection = async (action: any, want: any) => {
  // Temporarily remove unhandled Promise rejection listeners so that the unhandled rejections we
  // expect to see don't trigger a test failure (or terminate node).
  const event = 'unhandledRejection';
  const listenersBackup = process.rawListeners(event);
  process.removeAllListeners(event);
  let tempListener: Function;
  let asyncErr:any;
  try {
    const seenErrPromise = new Promise<void>((resolve) => {
      tempListener = (err:any) => {
        strict.equal(asyncErr, undefined);
        asyncErr = err;
        resolve();
      };
    });
    // @ts-ignore
    process.on(event, tempListener);
    await action();
    await seenErrPromise;
  } finally {
    // Restore the original listeners.
    // @ts-ignore
    process.off(event, tempListener);
    for (const listener of listenersBackup) { // @ts-ignore
      process.on(event, listener);
    }
  }
  await strict.rejects(Promise.reject(asyncErr), want);
};

describe(__filename, function () {
  describe('basic behavior', function () {
    it('takes a generator', async function () {
      strict.deepEqual([...new Stream((function* () { yield 0; yield 1; yield 2; })())], [0, 1, 2]);
    });

    it('takes an array', async function () {
      strict.deepEqual([...new Stream([0, 1, 2])], [0, 1, 2]);
    });

    it('takes an iterator', async function () {
      strict.deepEqual([...new Stream([0, 1, 2][Symbol.iterator]())], [0, 1, 2]);
    });

    it('supports empty iterators', async function () {
      strict.deepEqual([...new Stream([])], []);
    });

    it('is resumable', async function () {
      const s = new Stream((function* () { yield 0; yield 1; yield 2; })());
      let iter = s[Symbol.iterator]();
      strict.deepEqual(iter.next(), {value: 0, done: false});
      iter = s[Symbol.iterator]();
      strict.deepEqual(iter.next(), {value: 1, done: false});
      strict.deepEqual([...s], [2]);
    });

    it('supports return value', async function () {
      const s = new Stream((function* () { yield 0; return 1; })());
      const iter = s[Symbol.iterator]();
      strict.deepEqual(iter.next(), {value: 0, done: false});
      strict.deepEqual(iter.next(), {value: 1, done: true});
    });

    it('does not start until needed', async function () {
      let lastYield = null;
      new Stream((function* () { yield lastYield = 0; })());
      // Fetching from the underlying iterator should not start until the first value is fetched
      // from the stream.
      strict.equal(lastYield, null);
    });

    it('throw is propagated', async function () {
      const underlying = new DemoIterable();
      const s = new Stream(underlying);
      const iter = s[Symbol.iterator]();
      strict.deepEqual(iter.next(), {value: 0, done: false});
      const err = new Error('injected');
      strict.throws(() => iter.throw(err), err);
      strict.equal(underlying.errs[0], err);
    });

    it('return is propagated', async function () {
      const underlying = new DemoIterable();
      const s = new Stream(underlying);
      const iter = s[Symbol.iterator]();
      strict.deepEqual(iter.next(), {value: 0, done: false});
      strict.deepEqual(iter.return(42), {value: 42, done: true});
      strict.equal(underlying.rets[0], 42);
    });
  });

  describe('range', function () {
    it('basic', async function () {
      strict.deepEqual([...Stream.range(0, 3)], [0, 1, 2]);
    });

    it('empty', async function () {
      strict.deepEqual([...Stream.range(0, 0)], []);
    });

    it('positive start', async function () {
      strict.deepEqual([...Stream.range(3, 5)], [3, 4]);
    });

    it('negative start', async function () {
      strict.deepEqual([...Stream.range(-3, 0)], [-3, -2, -1]);
    });

    it('end before start', async function () {
      strict.deepEqual([...Stream.range(3, 0)], []);
    });
  });

  describe('batch', function () {
    it('empty', async function () {
      strict.deepEqual([...new Stream([]).batch(10)], []);
    });

    it('does not start until needed', async function () {
      let lastYield = null;
      new Stream((function* () { yield lastYield = 0; })()).batch(10);
      strict.equal(lastYield, null);
    });

    it('fewer than batch size', async function () {
      let lastYield = null;
      const values = (function* () {
        for (let i = 0; i < 5; i++) yield lastYield = i;
      })();
      const s = new Stream(values).batch(10);
      strict.equal(lastYield, null);
      strict.deepEqual(s[Symbol.iterator]().next(), {value: 0, done: false});
      strict.equal(lastYield, 4);
      strict.deepEqual([...s], [1, 2, 3, 4]);
      strict.equal(lastYield, 4);
    });

    it('exactly batch size', async function () {
      let lastYield = null;
      const values = (function* () {
        for (let i = 0; i < 5; i++) yield lastYield = i;
      })();
      const s = new Stream(values).batch(5);
      strict.equal(lastYield, null);
      strict.deepEqual(s[Symbol.iterator]().next(), {value: 0, done: false});
      strict.equal(lastYield, 4);
      strict.deepEqual([...s], [1, 2, 3, 4]);
      strict.equal(lastYield, 4);
    });

    it('multiple batches, last batch is not full', async function () {
      let lastYield = null;
      const values = (function* () {
        for (let i = 0; i < 10; i++) yield lastYield = i;
      })();
      const s = new Stream(values).batch(3);
      strict.equal(lastYield, null);
      const iter = s[Symbol.iterator]();
      strict.deepEqual(iter.next(), {value: 0, done: false});
      strict.equal(lastYield, 2);
      strict.deepEqual(iter.next(), {value: 1, done: false});
      strict.deepEqual(iter.next(), {value: 2, done: false});
      strict.equal(lastYield, 2);
      strict.deepEqual(iter.next(), {value: 3, done: false});
      strict.equal(lastYield, 5);
      strict.deepEqual([...s], [4, 5, 6, 7, 8, 9]);
      strict.equal(lastYield, 9);
    });

    it('batched Promise rejections are suppressed while iterating', async function () {
      let lastYield = null;
      const err = new Error('injected');
      const values = (function* () {
        lastYield = 'promise of 0';
        yield new Promise((resolve) => setTimeout(() => resolve(0), 100));
        lastYield = 'rejected Promise';
        yield Promise.reject(err);
        lastYield = 'promise of 2';
        yield Promise.resolve(2);
      })();
      const s = new Stream(values).batch(3);
      const iter = s[Symbol.iterator]();
      const nextp = iter.next().value;
      strict.equal(lastYield, 'promise of 2');
      strict.equal(await nextp, 0);
      await strict.rejects(iter.next().value, err);
      iter.return();
    });

    it('batched Promise rejections are unsuppressed when iteration completes', async function () {
      let lastYield = null;
      const err = new Error('injected');
      const values = (function* () {
        lastYield = 'promise of 0';
        yield new Promise((resolve) => setTimeout(() => resolve(0), 100));
        lastYield = 'rejected Promise';
        yield Promise.reject(err);
        lastYield = 'promise of 2';
        yield Promise.resolve(2);
      })();
      const s = new Stream(values).batch(3);
      const iter = s[Symbol.iterator]();
      strict.equal(await iter.next().value, 0);
      strict.equal(lastYield, 'promise of 2');
      await assertUnhandledRejection(() => iter.return(), err);
    });
  });

  describe('buffer', function () {
    it('empty', async function () {
      strict.deepEqual([...new Stream([]).buffer(10)], []);
    });

    it('does not start until needed', async function () {
      let lastYield = null;
      new Stream((function* () { yield lastYield = 0; })()).buffer(10);
      strict.equal(lastYield, null);
    });

    it('fewer than buffer size', async function () {
      let lastYield = null;
      const values = (function* () {
        for (let i = 0; i < 5; i++) yield lastYield = i;
      })();
      const s = new Stream(values).buffer(10);
      strict.equal(lastYield, null);
      strict.deepEqual(s[Symbol.iterator]().next(), {value: 0, done: false});
      strict.equal(lastYield, 4);
      strict.deepEqual([...s], [1, 2, 3, 4]);
      strict.equal(lastYield, 4);
    });

    it('exactly buffer size', async function () {
      let lastYield = null;
      const values = (function* () {
        for (let i = 0; i < 5; i++) yield lastYield = i;
      })();
      const s = new Stream(values).buffer(5);
      strict.equal(lastYield, null);
      strict.deepEqual(s[Symbol.iterator]().next(), {value: 0, done: false});
      strict.equal(lastYield, 4);
      strict.deepEqual([...s], [1, 2, 3, 4]);
      strict.equal(lastYield, 4);
    });

    it('more than buffer size', async function () {
      let lastYield = null;
      const values = (function* () {
        for (let i = 0; i < 10; i++) yield lastYield = i;
      })();
      const s = new Stream(values).buffer(3);
      strict.equal(lastYield, null);
      const iter = s[Symbol.iterator]();
      strict.deepEqual(iter.next(), {value: 0, done: false});
      strict.equal(lastYield, 3);
      strict.deepEqual(iter.next(), {value: 1, done: false});
      strict.equal(lastYield, 4);
      strict.deepEqual(iter.next(), {value: 2, done: false});
      strict.equal(lastYield, 5);
      strict.deepEqual([...s], [3, 4, 5, 6, 7, 8, 9]);
      strict.equal(lastYield, 9);
    });

    it('buffered Promise rejections are suppressed while iterating', async function () {
      let lastYield = null;
      const err = new Error('injected');
      const values = (function* () {
        lastYield = 'promise of 0';
        yield new Promise((resolve) => setTimeout(() => resolve(0), 100));
        lastYield = 'rejected Promise';
        yield Promise.reject(err);
        lastYield = 'promise of 2';
        yield Promise.resolve(2);
      })();
      const s = new Stream(values).buffer(3);
      const iter = s[Symbol.iterator]();
      const nextp = iter.next().value;
      strict.equal(lastYield, 'promise of 2');
      strict.equal(await nextp, 0);
      await strict.rejects(iter.next().value, err);
      iter.return();
    });

    it('buffered Promise rejections are unsuppressed when iteration completes', async function () {
      let lastYield = null;
      const err = new Error('injected');
      const values = (function* () {
        lastYield = 'promise of 0';
        yield new Promise((resolve) => setTimeout(() => resolve(0), 100));
        lastYield = 'rejected Promise';
        yield Promise.reject(err);
        lastYield = 'promise of 2';
        yield Promise.resolve(2);
      })();
      const s = new Stream(values).buffer(3);
      const iter = s[Symbol.iterator]();
      strict.equal(await iter.next().value, 0);
      strict.equal(lastYield, 'promise of 2');
      await assertUnhandledRejection(() => iter.return(), err);
    });
  });

  describe('map', function () {
    it('empty', async function () {
      let called = false;
      strict.deepEqual([...new Stream([]).map(() => called = true)], []);
      strict.equal(called, false);
    });

    it('does not start until needed', async function () {
      let called = false;
      strict.deepEqual([...new Stream([]).map(() => called = true)], []);
      new Stream((function* () { yield 0; })()).map(() => called = true);
      strict.equal(called, false);
    });

    it('works', async function () {
      const calls:any[] = [];
      strict.deepEqual(
          [...new Stream([0, 1, 2]).map((v:any) => { calls.push(v); return 2 * v; })], [0, 2, 4]);
      strict.deepEqual(calls, [0, 1, 2]);
    });
  });
});
