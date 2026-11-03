'use strict';

const SessionStore = require('../../../node/db/SessionStore');
import {strict as assert} from 'assert';
const common = require('../common');
const db = require('../../../node/db/DB');
import util from 'util';
import sinon from 'sinon';

type Session = {
  set: (sid: string|null,sess:any, sess2:any) => void;
  get: (sid:string|null) => any;
  destroy: (sid:string|null) => void;
  touch: (sid:string|null, sess:any, sess2:any) => void;
  shutdown: () => void;
  startCleanup: () => void;
  _cleanup: () => Promise<void>;
  _cleanupTimer: any;
  _timers: any;
  _get: (sid: string) => Promise<any>;
}

describe(__filename, function () {
  let ss: Session|null;
  let sid: string|null;
  // Fake clock driving the store's expiration timers and its notion of "now". The DB keeps using
  // real timers, so awaiting DB calls never moves the store's clock: expiry is only reached when a
  // test explicitly advances time, no matter how slow the machine is.
  let clock: sinon.SinonFakeTimers|null = null;
  // Records the DB reads kicked off by the store's expiration timers (the timer callbacks call
  // `this._get()`; the public callback API does not go through the instance property).
  let timerGets: sinon.SinonSpy;

  const set = async (sess: string|null) => await util.promisify(ss!.set).call(ss, sid, sess);
  const get = async () => await util.promisify(ss!.get).call(ss, sid);
  const destroy = async () => await util.promisify(ss!.destroy).call(ss, sid);
  const touch = async (sess: Session) => await util.promisify(ss!.touch).call(ss, sid, sess);

  const now = () => clock!.now;

  // Replaces `ss` with a new store whose timers run on a fresh fake clock.
  const newStore = (refresh?: number) => {
    if (ss != null) ss.shutdown();
    if (clock != null) clock.uninstall();
    ss = new SessionStore(refresh);
    const timers = {Date, setTimeout, clearTimeout};
    // `global` is supported by sinon (it fakes the given object instead of globalThis) but is
    // missing from @types/sinon, hence the cast.
    clock = sinon.useFakeTimers(
        {global: timers, now: Date.now(), toFake: ['Date', 'setTimeout', 'clearTimeout']} as any);
    ss!._timers = timers;
    timerGets = sinon.spy(ss!, '_get');
  };

  // Advances the store's clock, firing any due expiration timers, and waits for the DB work those
  // timers started to finish.
  const advance = async (ms: number) => {
    clock!.tick(ms);
    await Promise.all(timerGets.returnValues);
  };

  before(async function () {
    await common.init();
  });

  beforeEach(async function () {
    newStore();
    sid = common.randomString();
  });

  afterEach(async function () {
    if (ss != null) {
      if (sid != null) await destroy();
      ss.shutdown();
    }
    if (clock != null) clock.uninstall();
    clock = null;
    sid = null;
    ss = null;
  });

  describe('set', function () {
    it('set of null is a no-op', async function () {
      await set(null);
      assert(await db.get(`sessionstorage:${sid}`) == null);
    });

    it('set of non-expiring session', async function () {
      const sess:any = {foo: 'bar', baz: {asdf: 'jkl;'}};
      await set(sess);
      assert.equal(JSON.stringify(await db.get(`sessionstorage:${sid}`)), JSON.stringify(sess));
    });

    it('set of session that expires', async function () {
      const sess:any  = {foo: 'bar', cookie: {expires: new Date(now() + 300)}};
      await set(sess);
      assert.equal(JSON.stringify(await db.get(`sessionstorage:${sid}`)), JSON.stringify(sess));
      // Writing should start a timeout that purges the record once expiry passes.
      await advance(299);
      assert.equal(JSON.stringify(await db.get(`sessionstorage:${sid}`)), JSON.stringify(sess));
      await advance(1);
      assert(await db.get(`sessionstorage:${sid}`) == null);
    });

    it('set of already expired session', async function () {
      const sess:any  = {foo: 'bar', cookie: {expires: new Date(1)}};
      await set(sess);
      // No record should have been created.
      assert(await db.get(`sessionstorage:${sid}`) == null);
    });

    it('switch from non-expiring to expiring', async function () {
      const sess:any  = {foo: 'bar'};
      await set(sess);
      const sess2:any  = {foo: 'bar', cookie: {expires: new Date(now() + 300)}};
      await set(sess2);
      await advance(300);
      assert(await db.get(`sessionstorage:${sid}`) == null);
    });

    it('switch from expiring to non-expiring', async function () {
      const sess:any  = {foo: 'bar', cookie: {expires: new Date(now() + 300)}};
      await set(sess);
      const sess2:any  = {foo: 'bar'};
      await set(sess2);
      await advance(330);
      assert(timerGets.notCalled);
      assert.equal(JSON.stringify(await db.get(`sessionstorage:${sid}`)), JSON.stringify(sess2));
    });
  });

  describe('get', function () {
    it('get of non-existent entry', async function () {
      assert(await get() == null);
    });

    it('set+get round trip', async function () {
      const sess:any  = {foo: 'bar', baz: {asdf: 'jkl;'}};
      await set(sess);
      assert.equal(JSON.stringify(await get()), JSON.stringify(sess));
    });

    it('get of record from previous run (no expiration)', async function () {
      const sess = {foo: 'bar', baz: {asdf: 'jkl;'}};
      await db.set(`sessionstorage:${sid}`, sess);
      assert.equal(JSON.stringify(await get()), JSON.stringify(sess));
    });

    it('get of record from previous run (not yet expired)', async function () {
      const sess = {foo: 'bar', cookie: {expires: new Date(now() + 300)}};
      await db.set(`sessionstorage:${sid}`, sess);
      assert.equal(JSON.stringify(await get()), JSON.stringify(sess));
      // Reading should start a timeout that purges the record once expiry passes.
      await advance(300);
      assert(await db.get(`sessionstorage:${sid}`) == null);
    });

    it('get of record from previous run (already expired)', async function () {
      const sess = {foo: 'bar', cookie: {expires: new Date(1)}};
      await db.set(`sessionstorage:${sid}`, sess);
      assert(await get() == null);
      assert(await db.get(`sessionstorage:${sid}`) == null);
    });

    it('external expiration update is picked up', async function () {
      const sess:any  = {foo: 'bar', cookie: {expires: new Date(now() + 300)}};
      await set(sess);
      assert.equal(JSON.stringify(await get()), JSON.stringify(sess));
      const sess2 = {...sess, cookie: {expires: new Date(now() + 600)}};
      await db.set(`sessionstorage:${sid}`, sess2);
      assert.equal(JSON.stringify(await get()), JSON.stringify(sess2));
      await advance(330);
      // The original timeout should not have fired.
      assert(timerGets.notCalled);
      assert.equal(JSON.stringify(await get()), JSON.stringify(sess2));
    });
  });

  describe('shutdown', function () {
    it('shutdown cancels timeouts', async function () {
      const sess:any  = {foo: 'bar', cookie: {expires: new Date(now() + 300)}};
      await set(sess);
      assert.equal(JSON.stringify(await get()), JSON.stringify(sess));
      ss!.shutdown();
      await advance(330);
      assert(timerGets.notCalled);
      // The record should not have been automatically purged.
      assert.equal(JSON.stringify(await db.get(`sessionstorage:${sid}`)), JSON.stringify(sess));
    });
  });

  describe('destroy', function () {
    it('destroy deletes the database record', async function () {
      const sess:any  = {cookie: {expires: new Date(now() + 300)}};
      await set(sess);
      await destroy();
      assert(await db.get(`sessionstorage:${sid}`) == null);
    });

    it('destroy cancels the timeout', async function () {
      const sess:any  = {cookie: {expires: new Date(now() + 300)}};
      await set(sess);
      await destroy();
      await db.set(`sessionstorage:${sid}`, sess);
      await advance(330);
      assert(timerGets.notCalled);
      assert.equal(JSON.stringify(await db.get(`sessionstorage:${sid}`)), JSON.stringify(sess));
    });

    it('destroy session that does not exist', async function () {
      await destroy();
    });
  });

  describe('touch without refresh', function () {
    it('touch before set is equivalent to set if session expires', async function () {
      const sess:any  = {cookie: {expires: new Date(now() + 1000)}};
      await touch(sess);
      assert.equal(JSON.stringify(await get()), JSON.stringify(sess));
    });

    it('touch updates observed expiration but not database', async function () {
      const start = now();
      const sess:any  = {cookie: {expires: new Date(start + 200)}};
      await set(sess);
      const sess2:any  = {cookie: {expires: new Date(start + 12000)}};
      await touch(sess2);
      assert.equal(JSON.stringify(await db.get(`sessionstorage:${sid}`)), JSON.stringify(sess));
      assert.equal(JSON.stringify(await get()), JSON.stringify(sess2));
    });
  });

  describe('touch with refresh', function () {
    beforeEach(async function () {
      newStore(200);
    });

    it('touch before set is equivalent to set if session expires', async function () {
      const sess:any  = {cookie: {expires: new Date(now() + 1000)}};
      await touch(sess);
      assert.equal(JSON.stringify(await get()), JSON.stringify(sess));
    });

    it('touch before eligible for refresh updates expiration but not DB', async function () {
      const start = now();
      const sess:any  = {foo: 'bar', cookie: {expires: new Date(start + 1000)}};
      await set(sess);
      const sess2:any  = {foo: 'bar', cookie: {expires: new Date(start + 1001)}};
      await touch(sess2);
      assert.equal(JSON.stringify(await db.get(`sessionstorage:${sid}`)), JSON.stringify(sess));
      assert.equal(JSON.stringify(await get()), JSON.stringify(sess2));
    });

    it('touch before eligible for refresh updates timeout', async function () {
      const start = now();
      const sess:any  = {foo: 'bar', cookie: {expires: new Date(start + 200)}};
      await set(sess);
      await advance(100);
      const sess2:any  = {foo: 'bar', cookie: {expires: new Date(start + 399)}};
      await touch(sess2);
      await advance(110);
      // Past the original expiry, but the touch moved the timeout out.
      assert(timerGets.notCalled);
      assert.equal(JSON.stringify(await db.get(`sessionstorage:${sid}`)), JSON.stringify(sess));
      assert.equal(JSON.stringify(await get()), JSON.stringify(sess2));
      // The rescheduled timeout purges the record once the touched expiry passes.
      await advance(189);
      assert(await db.get(`sessionstorage:${sid}`) == null);
    });

    it('touch after eligible for refresh updates db', async function () {
      const start = now();
      const sess:any  = {foo: 'bar', cookie: {expires: new Date(start + 2000)}};
      await set(sess);
      await advance(100);
      const sess2:any  = {foo: 'bar', cookie: {expires: new Date(start + 4000)}};
      await touch(sess2);
      await advance(110);
      assert.equal(JSON.stringify(await db.get(`sessionstorage:${sid}`)), JSON.stringify(sess2));
      assert.equal(JSON.stringify(await get()), JSON.stringify(sess2));
    });

    it('refresh=0 updates db every time', async function () {
      newStore(0);
      const sess:any  = {foo: 'bar', cookie: {expires: new Date(now() + 1000)}};
      await set(sess);
      await db.remove(`sessionstorage:${sid}`);
      await touch(sess); // No change in expiration time.
      assert.equal(JSON.stringify(await db.get(`sessionstorage:${sid}`)), JSON.stringify(sess));
      await db.remove(`sessionstorage:${sid}`);
      await touch(sess); // No change in expiration time.
      assert.equal(JSON.stringify(await db.get(`sessionstorage:${sid}`)), JSON.stringify(sess));
    });
  });

  // Regression tests for https://github.com/ether/etherpad-lite/issues/5010
  describe('cleanup', function () {
    it('removes expired sessions', async function () {
      const expiredSid = `cleanup_expired_${common.randomString()}`;
      await db.set(`sessionstorage:${expiredSid}`, {
        cookie: {path: '/', expires: new Date(1).toJSON(), httpOnly: true},
      });
      await ss!._cleanup();
      assert(await db.get(`sessionstorage:${expiredSid}`) == null);
    });

    it('removes empty sessions with no expiry', async function () {
      const emptySid = `cleanup_empty_${common.randomString()}`;
      await db.set(`sessionstorage:${emptySid}`, {
        cookie: {path: '/', _expires: null, originalMaxAge: null, httpOnly: true},
      });
      await ss!._cleanup();
      assert(await db.get(`sessionstorage:${emptySid}`) == null);
    });

    it('preserves sessions with user data and no expiry', async function () {
      const dataSid = `cleanup_data_${common.randomString()}`;
      const sess = {
        cookie: {path: '/', _expires: null, httpOnly: true},
        user: {name: 'test'},
      };
      await db.set(`sessionstorage:${dataSid}`, sess);
      await ss!._cleanup();
      assert.equal(JSON.stringify(await db.get(`sessionstorage:${dataSid}`)), JSON.stringify(sess));
      await db.remove(`sessionstorage:${dataSid}`);
    });

    it('preserves non-expired sessions', async function () {
      const validSid = `cleanup_valid_${common.randomString()}`;
      const sess = {
        cookie: {path: '/', expires: new Date(Date.now() + 60000).toJSON(), httpOnly: true},
      };
      await db.set(`sessionstorage:${validSid}`, sess);
      await ss!._cleanup();
      assert.equal(JSON.stringify(await db.get(`sessionstorage:${validSid}`)), JSON.stringify(sess));
      await db.remove(`sessionstorage:${validSid}`);
    });

    it('shutdown cancels pending cleanup timer', async function () {
      ss!.startCleanup();
      ss!.shutdown();
      // After shutdown, the timer should be cleared.
      assert(ss!._cleanupTimer == null);
    });

    // Regression for https://github.com/ether/etherpad/issues/7830 — cleanup
    // used to load every sessionstorage key into a single array; on huge DBs
    // this OOMed. Verifies the paged iteration still hits every key when the
    // count exceeds CLEANUP_PAGE_SIZE — we seed a few-row spread and force a
    // small page size to keep the test fast.
    it('pages across a large sessionstorage keyspace', async function () {
      // Tag rows so the assertion ignores anything other tests left behind.
      const tag = common.randomString();
      const expiredSids: string[] = [];
      const validSids: string[] = [];
      // Seed 25 expired + 25 valid rows. The default CLEANUP_PAGE_SIZE (500)
      // would cover this in one call, so we monkey-patch the constant for
      // this test by stubbing DB.findKeysPaged to enforce a small page.
      const real = db.findKeysPaged;
      let pageCalls = 0;
      db.findKeysPaged = async (key: string, notKey: any, opts: any) => {
        pageCalls++;
        return await real.call(db, key, notKey, {...opts, limit: 4});
      };
      try {
        for (let i = 0; i < 25; i++) {
          const sid = `cleanup_paged_exp_${tag}_${String(i).padStart(2, '0')}`;
          expiredSids.push(sid);
          await db.set(`sessionstorage:${sid}`, {
            cookie: {path: '/', expires: new Date(1).toJSON(), httpOnly: true},
          });
        }
        for (let i = 0; i < 25; i++) {
          const sid = `cleanup_paged_val_${tag}_${String(i).padStart(2, '0')}`;
          validSids.push(sid);
          await db.set(`sessionstorage:${sid}`, {
            cookie: {
              path: '/', expires: new Date(Date.now() + 60000).toJSON(), httpOnly: true,
            },
          });
        }
        await ss!._cleanup();
        for (const sid of expiredSids) {
          assert(await db.get(`sessionstorage:${sid}`) == null, `expired ${sid} not removed`);
        }
        for (const sid of validSids) {
          assert(await db.get(`sessionstorage:${sid}`) != null, `valid ${sid} was wrongly removed`);
        }
        // page size 4 over 50 rows -> at least 12 paged calls (final page may
        // be short). Confirms we actually iterated.
        assert(pageCalls >= 12, `expected paged iteration (got ${pageCalls} calls)`);
      } finally {
        db.findKeysPaged = real;
        // Symmetric cleanup — if an assertion threw earlier, expiredSids may
        // still be present in the DB. Remove both groups so the test leaves
        // no rows behind even on failure.
        for (const sid of [...expiredSids, ...validSids]) {
          await db.remove(`sessionstorage:${sid}`);
        }
      }
    });
  });
});
