import {ArgsExpressType} from "../../types/ArgsExpressType";
const db = require('../../db/DB');
import crypto from 'crypto'
import settings from '../../utils/Settings';


type TokenTransferRequest = {
  token: string;
  // Decoded JSON text of the client preferences (not cookie wire bytes).
  // Named after the legacy HTTP cookie for compatibility with records and
  // clients that pre-date ether/etherpad#8171; it holds the preferences for
  // HTTP and HTTPS alike.
  prefsHttp: string,
  // Optional because legacy records from older code paths persisted
  // without it. The GET handler treats absent/non-numeric createdAt as
  // expired (safe fallback); the type reflects that.
  createdAt?: number;
}

// Keep the legacy on-the-wire key shape so any in-flight transfers
// created before this change are still redeemable.
const tokenTransferKey = (id: string) => `tokenTransfer::${id}`;

// Transfer records have a hard TTL — the legitimate flow is "scan a QR
// code on another device and click within a few minutes". A stale id
// should not be redeemable indefinitely.
const TRANSFER_TTL_MS = 5 * 60 * 1000;

// The pad client (pad_cookie.ts) stores preferences in `prefs` over HTTPS and
// in `prefsHttp` over HTTP (see doc/cookies.md).
const prefsCookieName = (secure: boolean) => secure ? 'prefs' : 'prefsHttp';

// Returns canonical JSON text for a preferences object, or '' if `value` is
// not one. Accepts decoded JSON (e.g. from cookie-parser) as well as the raw
// percent-encoded cookie text that older clients read from document.cookie,
// so the value is decoded exactly once before res.cookie() re-encodes it.
const parsePrefsObject = (text: string): string => {
  try {
    const parsed = JSON.parse(text);
    if (parsed != null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return JSON.stringify(parsed);
    }
  } catch (err) {
    // Not JSON.
  }
  return '';
};

const normalizePrefs = (value: unknown): string => {
  if (typeof value !== 'string' || value === '') return '';
  const direct = parsePrefsObject(value);
  if (direct) return direct;
  try {
    return parsePrefsObject(decodeURIComponent(value));
  } catch (err) {
    return ''; // Malformed percent-encoding.
  }
};

export const expressCreateServer =  (hookName:string, {app}:ArgsExpressType) => {
  app.post('/tokenTransfer', async (req: any, res) => {
    // The author token is HttpOnly (ether/etherpad#6701 PR3) so the browser
    // cannot read it. Read it off the request's own cookie jar instead of
    // trusting the request body. The client still supplies non-HttpOnly
    // prefs via body because `prefsHttp` is intentionally JS-readable.
    const cp = settings.cookie.prefix || '';
    const authorToken: string | undefined =
        req.cookies?.[`${cp}token`] || req.cookies?.token;
    const body = (req.body || {}) as Partial<TokenTransferRequest>;
    if (!authorToken) {
      return res.status(400).send({error: 'No author cookie to transfer'});
    }

    // Prefer the preferences cookie the request itself carries (decoded by
    // cookie-parser), trying the name for the request's protocol first. The
    // client-supplied body value is only a fallback.
    const secure = Boolean(req.secure);
    const cookieCandidates = [prefsCookieName(secure), prefsCookieName(!secure)]
        .flatMap((name) => [`${cp}${name}`, name])
        .map((name) => req.cookies?.[name]);
    const prefs = [...cookieCandidates, body.prefsHttp]
        .map(normalizePrefs)
        .find((v) => v !== '') || '';

    const id = crypto.randomUUID();
    const token: TokenTransferRequest = {
      token: authorToken,
      prefsHttp: prefs,
      createdAt: Date.now(),
    };

    await db.set(tokenTransferKey(id), token);
    res.send({id});
  })

  app.get('/tokenTransfer/:token', async (req: any, res) => {
    const id = req.params.token;
    if (!id) {
      return res.status(400).send({error: 'Invalid request'});
    }

    const key = tokenTransferKey(id);
    const tokenData: TokenTransferRequest | undefined = await db.get(key);
    if (!tokenData) {
      return res.status(404).send({error: 'Token not found'});
    }

    // Single-use: remove the record BEFORE the response is sent, so a
    // parallel request that wins the race observes an already-redeemed
    // transfer rather than a second usable copy.
    await db.remove(key);

    // Enforce the TTL. Absent/non-numeric createdAt is treated as
    // expired so legacy records that pre-date this code path are
    // rejected on the safe side.
    const createdAt = typeof tokenData.createdAt === 'number'
        ? tokenData.createdAt : 0;
    if (Date.now() - createdAt > TRANSFER_TTL_MS) {
      return res.status(410).send({error: 'Token expired'});
    }

    const p = settings.cookie.prefix;
    // Re-issue the author token on the new device as an HttpOnly cookie to
    // match the /p/:pad path (ether/etherpad#6701 PR3). Without this, the
    // transfer would reintroduce a JS-readable copy of the token.
    res.cookie(`${p}token`, tokenData.token, {
      path: '/',
      maxAge: 1000 * 60 * 60 * 24 * 365,
      httpOnly: true,
      secure: Boolean(req.secure),
      sameSite: 'lax',
    });
    // Preferences are intentionally JS-readable — do NOT mark HttpOnly. Write
    // them under the name the pad client reads for this protocol, and pass
    // decoded JSON so res.cookie() performs the only encoding step
    // (ether/etherpad#8171). Skip the cookie when there is nothing to
    // transfer so existing preferences on this device are left untouched.
    const prefs = normalizePrefs(tokenData.prefsHttp);
    if (prefs) {
      res.cookie(`${p}${prefsCookieName(Boolean(req.secure))}`, prefs, {
        path: '/',
        maxAge: 1000 * 60 * 60 * 24 * 365,
        secure: Boolean(req.secure),
        sameSite: 'lax',
      });
    }
    // Body must NOT echo the author token — the HttpOnly cookie above
    // is the only channel. Body advertises only the non-secret prefs
    // the client needs to wire up locally.
    res.send({ok: true, prefsHttp: prefs});
  })
}
