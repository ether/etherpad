

import {DeriveModel} from "../types/DeriveModel";
import {LegacyParams} from "../types/LegacyParams";

const {Buffer} = require('buffer');
const crypto = require('./crypto');
const db = require('../db/DB');
const log4js = require('log4js');

class Kdf {
  async generateParams(): Promise<{ salt: string; digest: string; keyLen: number; secret: string }> { throw new Error('not implemented'); }
  async derive(params: DeriveModel, info: any) { throw new Error('not implemented'); }
}

class LegacyStaticSecret extends Kdf {
  async derive(params:any, info:any) { return params; }
}

class Hkdf extends Kdf {
  private readonly _digest: string
  private readonly _keyLen: number
  constructor(digest:string, keyLen:number) {
    super();
    this._digest = digest;
    this._keyLen = keyLen;
  }

  async generateParams(): Promise<{ salt: string; digest: string; keyLen: number; secret: string }> {
    const [secret, salt] = (await Promise.all([
      crypto.randomBytes(this._keyLen),
      crypto.randomBytes(this._keyLen),
    ])).map((b) => b.toString('hex'));
    return {digest: this._digest, keyLen: this._keyLen, salt, secret};
  }

  async derive(p: DeriveModel, info:any) {
    return Buffer.from(
        await crypto.hkdf(p.digest, p.secret, p.salt, info, p.keyLen)).toString('hex');
  }
}

// Key derivation algorithms. Do not modify entries in this array, except:
//   * It is OK to replace an unused algorithm with `null` after any entries in the database
//     using the algorithm have been deleted.
//   * It is OK to append a new algorithm to the end.
// If the entries are modified in any other way then key derivation might fail or produce invalid
// results due to broken compatibility with existing database records.
const algorithms = [
  new LegacyStaticSecret(),
  new Hkdf('sha256', 32),
];
const defaultAlgId = algorithms.length - 1;

// In JavaScript, the % operator is remainder, not modulus.
const mod = (a:number, n:number) => ((a % n) + n) % n;
const intervalStart = (t:number, interval:number) => t - mod(t, interval);

/**
 * Maintains an array of secrets across one or more Etherpad instances sharing the same database,
 * periodically rotating in a new secret and removing the oldest secret.
 *
 * The secrets are generated using a key derivation function (KDF) with input keying material coming
 * from a long-lived secret stored in the database (generated if missing).
 */
export class SecretRotator {
  readonly secrets: string[];
  private readonly _dbPrefix
  private readonly _interval
  private readonly _legacyStaticSecret
  private readonly _lifetime
  private readonly _logger
  private _updateTimeout:any
  private readonly _t
  /**
   * @param {string} dbPrefix - Database key prefix to use for tracking secret metadata.
   * @param {number} interval - How often to rotate in a new secret.
   * @param {number} lifetime - How long after the end of an interval before the secret is no longer
   *     useful.
   * @param {string} [legacyStaticSecret] - Optional secret to facilitate migration to secret
   *     rotation. If the oldest known secret starts after `lifetime` ago, this secret will cover
   *     the time period starting `lifetime` ago and ending at the start of that secret.
   */
  constructor(dbPrefix: string, interval: number, lifetime: number, legacyStaticSecret:string|null = null) {
    /**
     * The secrets. The first secret in this array is the one that should be used to generate new
     * MACs. All of the secrets in this array should be used when attempting to authenticate an
     * existing MAC. The contents of this array will be updated every `interval` milliseconds, but
     * the Array object itself will never be replaced with a new Array object.
     *
     * @type {string[]}
     * @public
     */
    this.secrets = [];
    Object.defineProperty(this, 'secrets', {writable: false}); // Defend against bugs.

    if (/[*:%]/.test(dbPrefix)) throw new Error(`dbPrefix contains an invalid char: ${dbPrefix}`);
    this._dbPrefix = dbPrefix;
    this._interval = interval;
    this._legacyStaticSecret = legacyStaticSecret;
    this._lifetime = lifetime;
    this._logger = log4js.getLogger(`secret-rotation ${dbPrefix}`);
    this._logger.debug(`new secret rotator (interval ${interval}, lifetime: ${lifetime})`);
    this._updateTimeout = null;

    // Indirections to facilitate testing.
    this._t = {now: Date.now.bind(Date), setTimeout, clearTimeout, algorithms};
  }

  async _publish(params: LegacyParams, id:string|null = null) {
    // Params are published to the db with a randomly generated key to avoid race conditions with
    // other instances.
    if (id == null) id = `${this._dbPrefix}:${(await crypto.randomBytes(32)).toString('hex')}`;
    await db.set(id, params);
    return id;
  }

  async start() {
    this._logger.debug('starting secret rotation');
    if (this._updateTimeout != null) return; // Already started.
    await this._update();
  }

  stop() {
    this._logger.debug('stopping secret rotation');
    this._t.clearTimeout(this._updateTimeout);
    this._updateTimeout = null;
  }

  async _deriveSecrets(p: any, now: number) {
    this._logger.debug('deriving secrets from', p);
    if (!p.interval) return [await algorithms[p.algId].derive(p.algParams, null)];
    const t0 = intervalStart(now, p.interval);
    // Start of the first interval covered by these params. To accommodate clock skew, p.interval is
    // subtracted. If we did not do this, then the following could happen:
    //   1. Instance (A) starts up and publishes params starting at the current interval.
    //   2. Instance (B) starts up with a clock that is in the previous interval.
    //   3. Instance (B) reads the params published by instance (A) and sees that there's no
    //      coverage of what it thinks is the current interval.
    //   4. Instance (B) generates and publishes new params that covers what it thinks is the
    //      current interval.
    //   5. Instance (B) starts generating MACs from a secret derived from the new params.
    //   6. Instance (A) fails to validate the MACs generated by instance (B) until it re-reads
    //      the published params, which might take as long as interval.
    // An alternative approach is to backdate p.start by p.interval when creating new params, but
    // this could affect the end time of legacy secrets.
    const tA = intervalStart(p.start - p.interval, p.interval);
    const tZ = intervalStart(p.end - 1, p.interval);
    this._logger.debug('now:', now, 't0:', t0, 'tA:', tA, 'tZ:', tZ);
    // Starts of intervals to derive keys for.
    const tNs = [];
    // Whether the derived secret for the interval starting at tN is still relevant. If there was no
    // clock skew, a derived secret is relevant until p.lifetime has elapsed since the end of the
    // interval. To accommodate clock skew, this end time is extended by p.interval.
    const expired = (tN:number) => now >= tN + (2 * p.interval) + p.lifetime;
    // Walk from t0 back until either the start of coverage or the derived secret is expired. t0
    // must always be the first entry in case p is the current params. (The first derived secret is
    // used for generating MACs, so the secret derived for t0 must be before the secrets derived for
    // other times.)
    for (let tN = Math.min(t0, tZ); tN >= tA && !expired(tN); tN -= p.interval) tNs.push(tN);
    // Include a future derived secret to accommodate clock skew.
    if (t0 + p.interval <= tZ) tNs.push(t0 + p.interval);
    this._logger.debug('deriving secrets for intervals with start times:', tNs);
    return await Promise.all(
        tNs.map(async (tN) => await algorithms[p.algId].derive(p.algParams, `${tN}`)));
  }

  async _update() {
    const now = this._t.now();
    const t0 = intervalStart(now, this._interval);
    let next = t0 + this._interval; // When this._update() should be called again.
    let legacyEnd = now;
    // TODO: This is racy. If two instances start up at the same time and there are no existing
    // matching publications, each will generate and publish their own paramters. In practice this
    // is unlikely to happen, and if it does it can be fixed by restarting both Etherpad instances.
    const dbKeys:string[] = await db.findKeys(`${this._dbPrefix}:*`, null) || [];
    let currentParams:any = null;
    let currentId = null;
    const dbWrites:any[] = [];
    const allParams = [];
    const legacyParams:LegacyParams[] = [];
    await Promise.all(dbKeys.map(async (dbKey) => {
      const p = await db.get(dbKey);
      if (p.algId === 0 && p.algParams === this._legacyStaticSecret) legacyParams.push(p);
      if (p.start < legacyEnd) legacyEnd = p.start;
      // Check if the params have expired. Params are still useful if a MAC generated by a secret
      // derived from the params is still valid, which can be true up to p.end + p.lifetime if
      // there was no clock skew. The p.interval factor is added to accommodate clock skew.
      // p.interval is null for legacy secrets, so fall back to this._interval.
      if (now >= p.end + p.lifetime + (p.interval || this._interval)) {
        // This initial keying material (or legacy secret) is expired.
        dbWrites.push(db.remove(dbKey));
        dbWrites[dbWrites.length - 1].catch(() => {}); // Prevent unhandled Promise rejections.
        return;
      }
      const t1 = p.interval && intervalStart(now, p.interval) + p.interval; // Start of next intrvl.
      const tA = intervalStart(p.start, p.interval); // Start of interval containing p.start.
      if (p.interval) next = Math.min(next, t1);
      // Determine if these params can be used to generate the current (active) secret. Note that
      // p.start is allowed to be in the next interval in case there is clock skew.
      if (p.interval && p.interval === this._interval && p.lifetime === this._lifetime &&
          tA <= t1 && p.end > now && (currentParams == null || p.start > currentParams.start)) {
        if (currentParams) allParams.push(currentParams);
        currentParams = p;
        currentId = dbKey;
      } else {
        allParams.push(p);
      }
    }));
    if (this._legacyStaticSecret && now < legacyEnd + this._lifetime + this._interval &&
        !legacyParams.find((p) => p.end + p.lifetime >= legacyEnd + this._lifetime)) {
      const d = new Date(legacyEnd).toJSON();
      this._logger.debug(`adding legacy static secret for ${d} with lifetime ${this._lifetime}`);
      const p: LegacyParams = {
        algId: 0,
        algParams: this._legacyStaticSecret,
        // The start time is equal to the end time so that this legacy secret does not affect the
        // end times of any legacy secrets published by other instances.
        start: legacyEnd,
        end: legacyEnd,
        interval: null,
        lifetime: this._lifetime,
      };
      allParams.push(p);
      dbWrites.push(this._publish(p));
      dbWrites[dbWrites.length - 1].catch(() => {}); // Prevent unhandled Promise rejections.
    }
    if (currentParams == null) {
      currentParams = {
        algId: defaultAlgId,
        algParams: await algorithms[defaultAlgId].generateParams(),
        start: now,
        end: now, // Extended below.
        interval: this._interval,
        lifetime: this._lifetime,
      };
    }
    // Advance currentParams's expiration time to the end of the next interval if needed. (The next
    // interval is used so that the parameters never expire under normal circumstances.) This must
    // be done before deriving any secrets from currentParams so that a secret for the next interval
    // can be included (in case there is clock skew).
    currentParams.end = Math.max(currentParams.end, t0 + (2 * this._interval));
    dbWrites.push(this._publish(currentParams, currentId));
    dbWrites[dbWrites.length - 1].catch(() => {}); // Prevent unhandled Promise rejections.
    // The secrets derived from currentParams MUST be the first secrets.
    const secrets = await this._deriveSecrets(currentParams, now);
    await Promise.all(
        allParams.map(async (p) => secrets.push(...await this._deriveSecrets(p, now))));
    // Update this.secrets all at once to avoid race conditions.
    this.secrets.length = 0;
    this.secrets.push(...secrets);
    this._logger.debug('active secrets:', this.secrets);
    // Wait for db writes to finish after updating this.secrets so that the new secrets become
    // active as soon as possible.
    await Promise.all(dbWrites);
    // Use an async function so that test code can tell when it's done publishing the new secrets.
    // The standard setTimeout() function ignores the callback's return value, but some of the tests
    // await the returned Promise.
    this._updateTimeout =
        this._t.setTimeout(async () => await this._update(), next - this._t.now());
  }
}

export default SecretRotator
