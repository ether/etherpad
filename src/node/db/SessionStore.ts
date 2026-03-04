// @ts-nocheck


const DB = require('./DB');
import expressSession from 'express-session'

const log4js = require('log4js');
const util = require('util');

const logger = log4js.getLogger('SessionStore');

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
  }

  shutdown() {
    for (const {timeout} of this._expirations.values()) clearTimeout(timeout);
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
