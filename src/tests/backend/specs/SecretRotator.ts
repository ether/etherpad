'use strict';

import {strict} from "assert";
const common = require('../common');
const crypto = require('../../../node/security/crypto');
const db = require('../../../node/db/DB');
const SecretRotator = require("../../../node/security/SecretRotator").SecretRotator;

const logger = common.logger;

// Greatest common divisor.
const gcd: Function = (...args:number[]) => (
  args.length === 1 ? args[0]
  : args.length === 2 ? ((args[1]) ? gcd(args[1], args[0] % args[1]) : Math.abs(args[0]))
  : gcd(args[0], gcd(...args.slice(1))));

// Least common multiple.
const lcm:Function = (...args: number[]) => (
  args.length === 1 ? args[0]
  : args.length === 2 ? Math.abs(args[0] * args[1]) / gcd(...args)
  : lcm(args[0], lcm(...args.slice(1))));

class FakeClock {
    _now: number;
    _nextId: number;
    _idle: Promise<any>;
    timeouts: Map<number, any>;

  constructor() {
    logger.debug('new fake clock');
    this._now = 0;
    this._nextId = 1;
    this._idle = Promise.resolve();
    this.timeouts = new Map();
  }

  _next() { return Math.min(...[...this.timeouts.values()].map((x) => x.when)); }
  async setNow(t: number) {
    logger.debug(`setting fake time to ${t}`);
    strict(t >= this._now);
    strict(t < Infinity);
    let n;
    while ((n = this._next()) <= t) {
      this._now = Math.max(this._now, Math.min(n, t));
      logger.debug(`fake time set to ${this._now}; firing timeouts...`);
      await this._fire();
    }
    this._now = t;
    logger.debug(`fake time set to ${this._now}`);
  }
  async advance(t: number) { await this.setNow(this._now + t); }
  async advanceToNext() {
    const n = this._next();
    if (n < this._now) await this._fire();
    else if (n < Infinity) await this.setNow(n);
  }
  async _fire() {
    // This method MUST NOT execute any of the setTimeout callbacks synchronously, otherwise
    // fc.setTimeout(fn, 0) would execute fn before fc.setTimeout() returns. Fortunately, the
    // ECMAScript standard guarantees that a function passed to Promise.prototype.then() will run
    // asynchronously.
    this._idle = this._idle.then(() => Promise.all(
        [...this.timeouts.values()]
            .filter(({when}) => when <= this._now)
            .sort((a, b) => a.when - b.when)
            .map(async ({id, fn}) => {
              this.clearTimeout(id);
              // With the standard setTimeout(), the callback function's return value is ignored.
              // Here we await the return value so that test code can block until timeout work is
              // done.
              await fn();
            })));
    await this._idle;
  }

  get now() { return this._now; }
  setTimeout(fn:Function, wait = 0) {
    const when = this._now + wait;
    const id = this._nextId++;
    this.timeouts.set(id, {id, fn, when});
    this._fire();
    return id;
  }
  clearTimeout(id:number) { this.timeouts.delete(id); }
}

// In JavaScript, the % operator is remainder, not modulus.
const mod = (a: number, n:number) => ((a % n) + n) % n;

describe(__filename, function () {
  let dbPrefix: string;
  let sr: any;
  let interval = 1e3;
  const lifetime = 1e4;
  const intervalStart = (t: number) => t - mod(t, interval);
  const hkdf = async (secret: string, salt:string, tN:number) => Buffer.from(
      await crypto.hkdf('sha256', secret, salt, `${tN}`, 32)).toString('hex');

  const newRotator = (s:string|null = null) => new SecretRotator(dbPrefix, interval, lifetime, s);

  const setFakeClock = (sr: { _t: { now: () => number; setTimeout: (fn: Function, wait?: number) => number; clearTimeout: (id: number) => void; }; }, fc:FakeClock|null = null) => {
    if (fc == null) fc = new FakeClock();
    sr._t = {
      now: () => fc!.now,
      setTimeout: fc.setTimeout.bind(fc),
      clearTimeout: fc.clearTimeout.bind(fc),
    };
    return fc;
  };

  before(async function () {
    await common.init();
  });

  beforeEach(async function () {
    dbPrefix = `test-SecretRotator-${common.randomString()}`;
    interval = 1e3;
  });

  afterEach(async function () {
    if (sr != null) sr.stop();
    sr = null;
    await Promise.all(
        (await db.findKeys(`${dbPrefix}:*`, null)).map(async (dbKey: string) => await db.remove(dbKey)));
  });

  describe('constructor', function () {
    it('creates empty secrets array', async function () {
      sr = newRotator();
      strict.deepEqual(sr.secrets, []);
    });

    for (const invalidChar of '*:%') {
      it(`rejects database prefixes containing ${invalidChar}`, async function () {
        dbPrefix += invalidChar;
        strict.throws(newRotator, /invalid char/);
      });
    }
  });

  describe('start', function () {
    it('does not replace secrets array', async function () {
      sr = newRotator();
      setFakeClock(sr);
      const {secrets} = sr;
      await sr.start();
      strict.equal(sr.secrets, secrets);
    });

    it('derives secrets', async function () {
      sr = newRotator();
      setFakeClock(sr);
      await sr.start();
      strict.equal(sr.secrets.length, 3); // Current (active), previous, and next.
      for (const s of sr.secrets) {
        strict.equal(typeof s, 'string');
        strict(s);
      }
      strict.equal(new Set(sr.secrets).size, sr.secrets.length); // The secrets should all differ.
    });

    it('publishes params', async function () {
      sr = newRotator();
      const fc = setFakeClock(sr);
      await sr.start();
      const dbKeys = await db.findKeys(`${dbPrefix}:*`, null);
      strict.equal(dbKeys.length, 1);
      const [id] = dbKeys;
      strict(id.startsWith(`${dbPrefix}:`));
      strict.notEqual(id.slice(dbPrefix.length + 1), '');
      const p = await db.get(id);
      const {secret, salt} = p.algParams;
      strict.deepEqual(p, {
        algId: 1,
        algParams: {
          digest: 'sha256',
          keyLen: 32,
          salt,
          secret,
        },
        start: fc.now,
        end: fc.now + (2 * interval),
        interval,
        lifetime,
      });
      strict.equal(typeof salt, 'string');
      strict.match(salt, /^[0-9a-f]{64}$/);
      strict.equal(typeof secret, 'string');
      strict.match(secret, /^[0-9a-f]{64}$/);
      strict.deepEqual(sr.secrets, await Promise.all(
          [0, -interval, interval].map(async (tN) => await hkdf(secret, salt, tN))));
    });

    it('reuses matching publication if unexpired', async function () {
      sr = newRotator();
      const fc = setFakeClock(sr);
      await sr.start();
      const {secrets} = sr;
      const dbKeys = await db.findKeys(`${dbPrefix}:*`, null);
      sr.stop();
      sr = newRotator();
      setFakeClock(sr, fc);
      await sr.start();
      strict.deepEqual(sr.secrets, secrets);
      strict.deepEqual(await db.findKeys(`${dbPrefix}:*`, null), dbKeys);
    });

    it('deletes expired publications', async function () {
      sr = newRotator();
      const fc = setFakeClock(sr);
      await sr.start();
      const [oldId] = await db.findKeys(`${dbPrefix}:*`, null);
      strict(oldId != null);
      sr.stop();
      const p = await db.get(oldId);
      await fc.setNow(p.end + p.lifetime + p.interval);
      sr = newRotator();
      setFakeClock(sr, fc);
      await sr.start();
      const ids = await db.findKeys(`${dbPrefix}:*`, null);
      strict.equal(ids.length, 1);
      const [newId] = ids;
      strict.notEqual(newId, oldId);
    });

    it('keeps expired publications until interval past expiration', async function () {
      sr = newRotator();
      const fc = setFakeClock(sr);
      await sr.start();
      const [, , future] = sr.secrets;
      sr.stop();
      const [origId] = await db.findKeys(`${dbPrefix}:*`, null);
      const p = await db.get(origId);
      await fc.advance(p.end + p.lifetime + p.interval - 1);
      sr = newRotator();
      setFakeClock(sr, fc);
      await sr.start();
      strict(sr.secrets.slice(1).includes(future));
      // It should have created a new publication, not extended the life of the old publication.
      strict.equal((await db.findKeys(`${dbPrefix}:*`, null)).length, 2);
      strict.deepEqual(await db.get(origId), p);
    });

    it('idempotent', async function () {
      sr = newRotator();
      const fc = setFakeClock(sr);
      await sr.start();
      strict.equal(fc.timeouts.size, 1);
      const secrets = [...sr.secrets];
      const dbKeys = await db.findKeys(`${dbPrefix}:*`, null);
      await sr.start();
      strict.equal(fc.timeouts.size, 1);
      strict.deepEqual(sr.secrets, secrets);
      strict.deepEqual(await db.findKeys(`${dbPrefix}:*`, null), dbKeys);
    });

    describe(`schedules update at next interval (= ${interval})`, function () {
      const testCases = [
        {now: 0, want: interval},
        {now: 1, want: interval},
        {now: interval - 1, want: interval},
        {now: interval, want: 2 * interval},
        {now: interval + 1, want: 2 * interval},
      ];
      for (const {now, want} of testCases) {
        it(`${now} -> ${want}`, async function () {
          sr = newRotator();
          const fc = setFakeClock(sr);
          await fc.setNow(now);
          await sr.start();
          strict.equal(fc.timeouts.size, 1);
          const [{when}] = fc.timeouts.values();
          strict.equal(when, want);
        });
      }

      it('multiple active params with different intervals', async function () {
        const intervals = [400, 600, 1000];
        const lcmi = lcm(...intervals);
        const wants:Set<number> = new Set();
        for (const i of intervals) for (let t = i; t <= lcmi; t += i) wants.add(t);
        const fcs = new FakeClock();
        const srs = intervals.map((i) => {
          interval = i;
          const sr = newRotator();
          setFakeClock(sr, fcs);
          return sr;
        });
        try {
          for (const sr of srs) await sr.start(); // Don't use Promise.all() otherwise they race.
          interval = intervals[intervals.length - 1];
          sr = newRotator();
          const fc = setFakeClock(sr); // Independent clock to test a single instance's behavior.
          await sr.start();
          for (const want of [...wants].sort((a, b) => a - b)) {
            logger.debug(`next timeout should be at ${want}`);
            await fc.advanceToNext();
            await fcs.setNow(fc.now); // Keep all of the publications alive.
            strict.equal(fc.now, want);
          }
        } finally {
          for (const sr of srs) sr.stop();
        }
      });
    });
  });

  describe('stop', function () {
    it('clears timeout', async function () {
      sr = newRotator();
      const fc = setFakeClock(sr);
      await sr.start();
      strict.notEqual(fc.timeouts.size, 0);
      sr.stop();
      strict.equal(fc.timeouts.size, 0);
    });

    it('safe to call multiple times', async function () {
      sr = newRotator();
      setFakeClock(sr);
      await sr.start();
      sr.stop();
      sr.stop();
    });
  });

  describe('legacy secret', function () {
    it('ends at now if there are no previously published secrets', async function () {
      sr = newRotator('legacy');
      const fc = setFakeClock(sr);
      // Use a time that isn't a multiple of interval in case there is a modular arithmetic bug that
      // would otherwise go undetected.
      await fc.setNow(1);
      strict(mod(fc.now, interval) !== 0);
      await sr.start();
      strict.equal(sr.secrets.length, 4); // 1 for the legacy secret, 3 for past, current, future
      strict(sr.secrets.slice(1).includes('legacy')); // Should not be the current secret.
      const ids = await db.findKeys(`${dbPrefix}:*`, null);
      const params = (await Promise.all(ids.map(async (id:string) => await db.get(id))))
          .sort((a, b) => a.algId - b.algId);
      strict.deepEqual(params, [
        {
          algId: 0,
          algParams: 'legacy',
          // The start time must equal the end time so that legacy secrets do not affect the end
          // times of legacy secrets published by other instances.
          start: fc.now,
          end: fc.now,
          lifetime,
          interval: null,
        },
        {
          algId: 1,
          algParams: params[1].algParams,
          start: fc.now,
          end: intervalStart(fc.now) + (2 * interval),
          interval,
          lifetime,
        },
      ]);
    });

    it('ends at the start of the oldest previously published secret', async function () {
      sr = newRotator();
      const fc = setFakeClock(sr);
      await fc.setNow(1);
      strict(mod(fc.now, interval) !== 0);
      const wantTime = fc.now;
      await sr.start();
      strict.equal(sr.secrets.length, 3);
      const [s1, s0, s2] = sr.secrets; // s1=current, s0=previous, s2=next
      sr.stop();
      // Use a time that is not a multiple of interval off of epoch or wantTime just in case there
      // is a modular arithmetic bug that would otherwise go undetected.
      await fc.advance(interval + 1);
      strict(mod(fc.now, interval) !== 0);
      strict(mod(fc.now - wantTime, interval) !== 0);
      sr = newRotator('legacy');
      setFakeClock(sr, fc);
      await sr.start();
      strict.equal(sr.secrets.length, 5); // s0 through s3 and the legacy secret.
      strict.deepEqual(sr.secrets, [s2, s1, s0, sr.secrets[3], 'legacy']);
      const ids = await db.findKeys(`${dbPrefix}:*`, null);
      const params = (await Promise.all(ids.map(async (id:string) => await db.get(id))))
          .sort((a, b) => a.algId - b.algId);
      strict.deepEqual(params, [
        {
          algId: 0,
          algParams: 'legacy',
          start: wantTime,
          end: wantTime,
          interval: null,
          lifetime,
        },
        {
          algId: 1,
          algParams: params[1].algParams,
          start: wantTime,
          end: intervalStart(fc.now) + (2 * interval),
          interval,
          lifetime,
        },
      ]);
    });

    it('multiple instances with different legacy secrets', async function () {
      sr = newRotator('legacy1');
      const fc = setFakeClock(sr);
      await sr.start();
      sr.stop();
      sr = newRotator('legacy2');
      setFakeClock(sr, fc);
      await sr.start();
      strict(sr.secrets.slice(1).includes('legacy1'));
      strict(sr.secrets.slice(1).includes('legacy2'));
    });

    it('multiple instances with the same legacy secret', async function () {
      sr = newRotator('legacy');
      const fc = setFakeClock(sr);
      await sr.start();
      sr.stop();
      sr = newRotator('legacy');
      setFakeClock(sr, fc);
      await sr.start();
      strict.deepEqual(sr.secrets, [...new Set(sr.secrets)]);
      // There shouldn't be multiple publications for the same legacy secret.
      strict.equal((await db.findKeys(`${dbPrefix}:*`, null)).length, 2);
    });

    it('legacy secret is included for interval after expiration', async function () {
      sr = newRotator();
      const fc = setFakeClock(sr);
      await sr.start();
      sr.stop();
      await fc.advance(lifetime + interval - 1);
      sr = newRotator('legacy');
      setFakeClock(sr, fc);
      await sr.start();
      strict(sr.secrets.slice(1).includes('legacy'));
    });

    it('legacy secret is not included if the oldest secret is old enough', async function () {
      sr = newRotator();
      const fc = setFakeClock(sr);
      await sr.start();
      sr.stop();
      await fc.advance(lifetime + interval);
      sr = newRotator('legacy');
      setFakeClock(sr, fc);
      await sr.start();
      strict(!sr.secrets.includes('legacy'));
    });

    it('dead secrets still affect legacy secret end time', async function () {
      sr = newRotator();
      const fc = setFakeClock(sr);
      await sr.start();
      const secrets = new Set(sr.secrets);
      sr.stop();
      await fc.advance(lifetime + (3 * interval));
      sr = newRotator('legacy');
      setFakeClock(sr, fc);
      await sr.start();
      strict(!sr.secrets.includes('legacy'));
      strict(!sr.secrets.some((s:string) => secrets.has(s)));
    });
  });

  describe('rotation', function () {
    it('no rotation before start of interval', async function () {
      sr = newRotator();
      const fc = setFakeClock(sr);
      strict.equal(fc.now, 0);
      await sr.start();
      const secrets = [...sr.secrets];
      await fc.advance(interval - 1);
      strict.deepEqual(sr.secrets, secrets);
    });

    it('does not replace secrets array', async function () {
      sr = newRotator();
      const fc = setFakeClock(sr);
      await sr.start();
      const [current] = sr.secrets;
      const secrets = sr.secrets;
      await fc.advance(interval);
      strict.notEqual(sr.secrets[0], current);
      strict.equal(sr.secrets, secrets);
    });

    it('future secret becomes current, new future is generated', async function () {
      sr = newRotator();
      const fc = setFakeClock(sr);
      await sr.start();
      const secrets = new Set(sr.secrets);
      strict.equal(secrets.size, 3);
      const [s1, s0, s2] = sr.secrets;
      await fc.advance(interval);
      strict.deepEqual(sr.secrets, [s2, s1, s0, sr.secrets[3]]);
      strict(!secrets.has(sr.secrets[3]));
    });

    it('expired publications are deleted', async function () {
      const origInterval = interval;
      sr = newRotator();
      const fc = setFakeClock(sr);
      await sr.start();
      sr.stop();
      ++interval; // Force new params so that the old params can expire.
      sr = newRotator();
      setFakeClock(sr, fc);
      await sr.start();
      strict.equal((await db.findKeys(`${dbPrefix}:*`, null)).length, 2);
      await fc.advance(lifetime + (3 * origInterval));
      strict.equal((await db.findKeys(`${dbPrefix}:*`, null)).length, 1);
    });

    it('old secrets are eventually removed', async function () {
      sr = newRotator();
      const fc = setFakeClock(sr);
      await sr.start();
      const [, s0] = sr.secrets;
      await fc.advance(lifetime + interval - 1);
      strict(sr.secrets.slice(1).includes(s0));
      await fc.advance(1);
      strict(!sr.secrets.includes(s0));
    });
  });

  describe('clock skew', function () {
    it('out of sync works if in adjacent interval', async function () {
      const srs = [newRotator(), newRotator()];
      const fcs = srs.map((sr) => setFakeClock(sr));
      for (const sr of srs) await sr.start(); // Don't use Promise.all() otherwise they race.
      strict.deepEqual(srs[0].secrets, srs[1].secrets);
      // Advance fcs[0] to the end of the interval after fcs[1].
      await fcs[0].advance((2 * interval) - 1);
      strict(srs[0].secrets.includes(srs[1].secrets[0]));
      strict(srs[1].secrets.includes(srs[0].secrets[0]));
      // Advance both by an interval.
      await Promise.all([fcs[1].advance(interval), fcs[0].advance(interval)]);
      strict(srs[0].secrets.includes(srs[1].secrets[0]));
      strict(srs[1].secrets.includes(srs[0].secrets[0]));
      // Advance fcs[1] to the end of the interval after fcs[0].
      await Promise.all([fcs[1].advance((3 * interval) - 1), fcs[0].advance(1)]);
      strict(srs[0].secrets.includes(srs[1].secrets[0]));
      strict(srs[1].secrets.includes(srs[0].secrets[0]));
    });

    it('start up out of sync', async function () {
      const srs = [newRotator(), newRotator()];
      const fcs = srs.map((sr) => setFakeClock(sr));
      await fcs[0].advance((2 * interval) - 1);
      await srs[0].start(); // Must start before srs[1] so that srs[1] starts in srs[0]'s past.
      await srs[1].start();
      strict(srs[0].secrets.includes(srs[1].secrets[0]));
      strict(srs[1].secrets.includes(srs[0].secrets[0]));
    });
  });
});
