import {timesLimit} from '../../../node/utils/promises';
import {describe, it, expect} from "vitest";

describe(__filename, function () {
  describe('promises.timesLimit', function () {
    let wantIndex = 0;

    type TestPromise = {
        promise?: Promise<void>,
        resolve?: () => void,
    }

    const testPromises: TestPromise[] = [];
    const makePromise = (index: number) => {
      // Make sure index increases by one each time.
      expect(index).toEqual(wantIndex++);
      // Save the resolve callback (so the test can trigger resolution)
      // and the promise itself (to wait for resolve to take effect).
      const p:TestPromise = {};
      p.promise = new Promise<void>((resolve) => {
        p.resolve = resolve;
      });
      testPromises.push(p);
      return p.promise;
    };

    const total = 11;
    const concurrency = 7;
    const timesLimitPromise = timesLimit(total, concurrency, makePromise);

    it('honors concurrency', async function () {
      expect(wantIndex).toEqual(concurrency);
    });

    it('creates another when one completes', async function () {
      const {promise, resolve} = testPromises.shift()!;
      resolve!();
      await promise;
      expect(wantIndex).toEqual(concurrency + 1);
    });

    it('creates the expected total number of promises', async function () {
      while (testPromises.length > 0) {
        // Resolve them in random order to ensure that the resolution order doesn't matter.
        const i = Math.floor(Math.random() * Math.floor(testPromises.length));
        const {promise, resolve} = testPromises.splice(i, 1)[0];
        resolve!();
        await promise;
      }
      expect(wantIndex).toEqual(total);
    });

    it('resolves', async function () {
      await timesLimitPromise;
    });

    it('does not create too many promises if total < concurrency', async function () {
      wantIndex = 0;
      expect(testPromises.length).toEqual(0);
      const total = 7;
      const concurrency = 11;
      const timesLimitPromise = timesLimit(total, concurrency, makePromise);
      while (testPromises.length > 0) {
        const {promise, resolve} = testPromises.pop()!;
        resolve!();
        await promise;
      }
      await timesLimitPromise;
      expect(wantIndex).toEqual(total);
    });

    it('accepts total === 0, concurrency > 0', async function () {
      wantIndex = 0;
      expect(testPromises.length).toEqual(0);
      await timesLimit(0, concurrency, makePromise);
      expect(wantIndex).toEqual(0);
    });

    it('accepts total === 0, concurrency === 0', async function () {
      wantIndex = 0;
      expect(testPromises.length).toEqual(0);
      await timesLimit(0, 0, makePromise);
      expect(wantIndex).toEqual(0);
    });

    it('rejects total > 0, concurrency === 0', async function () {
      expect(timesLimit(total, 0, makePromise)).rejects.toThrow(RangeError);
    });
  });
});
