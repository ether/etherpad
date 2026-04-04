// @ts-nocheck


const DB = require('./DB');
import expressSession from 'express-session'

const log4js = require('log4js');
const util = require('util');

const logger = log4js.getLogger('SessionStore');

// Sessions without an expiry date older than this are considered stale and will be cleaned up.
const STALE_SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

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
    this._cleanupInterval = null;
  }

  /**
   * Start periodic cleanup of expired/stale sessions from the database.
   */
  startCleanup() {
    // Run once on startup (deferred to avoid blocking), then periodically.
    setTimeout(() => this._cleanup().catch((err) => logger.error('Session cleanup error:', err)), 5000);
    this._cleanupInterval = setInterval(
        () => this._cleanup().catch((err) => logger.error('Session cleanup error:', err)),
        CLEANUP_INTERVAL_MS);
    // Don't prevent Node.js from exiting.
    if (this._cleanupInterval.unref) this._cleanupInterval.unref();
  }

  shutdown() {
    for (const {timeout} of this._expirations.values()) clearTimeout(timeout);
    if (this._cleanupInterval) {
      clearInterval(this._cleanupInterval);
      this._cleanupInterval = null;
    }
  }

  /**
   * Remove expired and stale sessions from the database. Expired sessions have a cookie.expires
   * date in the past. Stale sessions have no expiry and haven't been touched in STALE_SESSION_MAX_AGE_MS.
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
        // Session has no expiry — remove if it has no meaningful data beyond the default cookie.
        // These are the sessions that accumulate indefinitely (bug #5010).
        // We can't know when they were created, so we check if they have any data beyond the
        // cookie itself. If they only contain the cookie (no user session data), they're safe
        // to remove as stale.
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
      // Use this._get(), not this._destroy(), to destroy the DB record for the expired session.
      // This is done in case multiple Etherpad instances are sharing the same database and users
      // are bouncing between the instances. By using this._get(), this instance will query the DB
      // for the latest expiration time written by any of the instances, ensuring that the record
      // isn't prematurely deleted if the expiration time was updated by a different Etherpad
      // instance. (Important caveat: Client-side database caching, which ueberdb does by default,
      // could still cause the record to be prematurely deleted because this instance might get a
      // stale expiration time from cache.)
      exp.timeout = setTimeout(() => this._get(sid), exp.real - now);
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

module.exports = SessionStore;
