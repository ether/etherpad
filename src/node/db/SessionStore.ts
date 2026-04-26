// @ts-nocheck


import DB from './DB.js';
import expressSession from 'express-session';

import log4js from 'log4js';
import util from 'util';

const logger = log4js.getLogger('SessionStore');

// How often to run the cleanup of expired/stale sessions.
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

class SessionStore extends expressSession.Store {
  /**
   * @param {?number} [refresh] - How often (in milliseconds) `touch()` will update a session's
   *     database record with the cookie's latest expiration time. If the difference between the
   *     value saved in the database and the actual value is greater than this amount, the database
   *     record will be updated to reflect the actual value. Use this to avoid continual database
   *     writes caused by express-session's rolling=true feature (see
   *     https://github.com/expressjs/session#rolling). A good value is high enough to keep query
   *     rate low but low enough to avoid annoying premature logouts (session invalidation) if
   *     Etherpad is restarted. Use `null` to prevent `touch()` from ever updating the record.
   *     Ignored if the cookie does not expire.
   */
  constructor(refresh: number | null = null) {
    super();
    this._refresh = refresh;
    // Maps session ID to an object with the following properties:
    //   - `db`: Session expiration as recorded in the database (ms since epoch, not a Date).
    //   - `real`: Actual session expiration (ms since epoch, not a Date). Always greater than or
    //     equal to `db`.
    //   - `timeout`: Timeout ID for a timeout that will clean up the database record.
    this._expirations = new Map();
    this._cleanupTimer = null;
    this._cleanupRunning = false;
  }

  /**
   * Start periodic cleanup of expired/stale sessions from the database.
   * Uses chained setTimeout (not setInterval) to prevent overlapping runs.
   */
  startCleanup() {
    this._scheduleCleanup(5000); // First run 5s after startup.
  }

  _scheduleCleanup(delay: number) {
    this._cleanupTimer = setTimeout(async () => {
      try {
        await this._cleanup();
      } catch (err) {
        logger.error('Session cleanup error:', err);
      }
      // Schedule the next run only after this one completes.
      this._scheduleCleanup(CLEANUP_INTERVAL_MS);
    }, delay);
    // Don't prevent Node.js from exiting.
    if (this._cleanupTimer.unref) this._cleanupTimer.unref();
  }

  shutdown() {
    for (const {timeout} of this._expirations.values()) clearTimeout(timeout);
    if (this._cleanupTimer) {
      clearTimeout(this._cleanupTimer);
      this._cleanupTimer = null;
    }
  }

  /**
   * Remove expired and empty sessions from the database.
   *
   * - Sessions with an `expires` date in the past are removed (expired).
   * - Sessions with no expiry that contain no data beyond the default cookie are removed.
   *   These are the empty sessions that accumulate indefinitely (bug #5010) — they have
   *   `{cookie: {path: "/", _expires: null, ...}}` and nothing else.
   */
  async _cleanup() {
    const keys = await DB.findKeys('sessionstorage:*', null);
    if (!keys || keys.length === 0) return;
    const now = Date.now();
    let removed = 0;
    for (const key of keys) {
      const sess = await DB.get(key);
      if (!sess) {
        await DB.remove(key);
        removed++;
        continue;
      }
      const expires = sess.cookie?.expires;
      if (expires) {
        // Session has an expiry — remove if expired.
        if (new Date(expires).getTime() <= now) {
          await DB.remove(key);
          removed++;
        }
      } else {
        // Session has no expiry and no user data beyond the cookie — remove as empty/stale.
        const hasData = Object.keys(sess).some((k) => k !== 'cookie');
        if (!hasData) {
          await DB.remove(key);
          removed++;
        }
      }
    }
    if (removed > 0) {
      logger.info(`Session cleanup: removed ${removed} expired/stale sessions out of ${keys.length}`);
    }
  }

  async _updateExpirations(sid: string, sess: any, updateDbExp = true) {
    const exp = this._expirations.get(sid) || {};
    clearTimeout(exp.timeout);
    // @ts-ignore
    const {cookie: {expires} = {}} = sess || {};
    if (expires) {
      const sessExp = new Date(expires).getTime();
      if (updateDbExp) exp.db = sessExp;
      exp.real = Math.max(exp.real || 0, exp.db || 0, sessExp);
      const now = Date.now();
      if (exp.real <= now) return await this._destroy(sid);
      // If reading from the database, update the expiration with the latest value from touch() so
      // that touch() appears to write to the database every time even though it doesn't.
      if (typeof expires === 'string') sess.cookie.expires = new Date(exp.real).toJSON();
      // Schedule cleanup when the session is expected to expire. When the timeout fires, check
      // the in-memory expiry first — touch() may have extended it without rescheduling the timeout
      // (e.g., if touch's clearTimeout raced with the timer on a slow system). If the session was
      // extended, reschedule instead of reading from the DB which may return stale cached data.
      exp.timeout = setTimeout(() => {
        const currentExp = this._expirations.get(sid);
        if (currentExp && currentExp.real > Date.now()) {
          // Expiry was extended (e.g., by touch). Reschedule.
          currentExp.timeout = setTimeout(() => this._get(sid), currentExp.real - Date.now());
          return;
        }
        // Use this._get(), not this._destroy(), to query the DB for the latest expiration in case
        // multiple Etherpad instances share the database. (Caveat: client-side DB caching could
        // still cause premature deletion if the cache returns a stale expiration time.)
        this._get(sid);
      }, exp.real - now);
      this._expirations.set(sid, exp);
    } else {
      this._expirations.delete(sid);
    }
    return sess;
  }

  async _write(sid: string, sess: any) {
    await DB.set(`sessionstorage:${sid}`, sess);
  }

  async _get(sid: string) {
    logger.debug(`GET ${sid}`);
    const s = await DB.get(`sessionstorage:${sid}`);
    return await this._updateExpirations(sid, s);
  }

  async _set(sid: string, sess:any) {
    logger.debug(`SET ${sid}`);
    sess = await this._updateExpirations(sid, sess);
    if (sess != null) await this._write(sid, sess);
  }

  async _destroy(sid:string) {
    logger.debug(`DESTROY ${sid}`);
    clearTimeout((this._expirations.get(sid) || {}).timeout);
    this._expirations.delete(sid);
    await DB.remove(`sessionstorage:${sid}`);
  }

  // Note: express-session might call touch() before it calls set() for the first time. Ideally this
  // would behave like set() in that case but it's OK if it doesn't -- express-session will call
  // set() soon enough.
  async _touch(sid: string, sess:any) {
    logger.debug(`TOUCH ${sid}`);
    sess = await this._updateExpirations(sid, sess, false);
    if (sess == null) return; // Already expired.
    const exp = this._expirations.get(sid);
    // If the session doesn't expire, don't do anything. Ideally we would write the session to the
    // database if it didn't already exist, but we have no way of knowing that without querying the
    // database. The query overhead is not worth it because set() should be called soon anyway.
    if (exp == null) return;
    if (exp.db != null && (this._refresh == null || exp.real < exp.db + this._refresh)) return;
    await this._write(sid, sess);
    exp.db = new Date(sess.cookie.expires).getTime();
  }
}

// express-session doesn't support Promise-based methods. This is where the callbackified versions
// used by express-session are defined.
for (const m of ['get', 'set', 'destroy', 'touch']) {
  SessionStore.prototype[m] = util.callbackify(SessionStore.prototype[`_${m}`]);
}

export default SessionStore;
