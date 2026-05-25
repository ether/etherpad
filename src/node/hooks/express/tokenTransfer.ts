import {ArgsExpressType} from "../../types/ArgsExpressType.js";
import db from '../../db/DB.js';
import crypto from 'crypto'
import settings from '../../utils/Settings.js';


type TokenTransferRequest = {
  token: string;
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

    const id = crypto.randomUUID();
    const token: TokenTransferRequest = {
      token: authorToken,
      prefsHttp: body.prefsHttp || '',
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
    // prefsHttp is intentionally JS-readable — do NOT mark HttpOnly.
    res.cookie(`${p}prefsHttp`, tokenData.prefsHttp, {
      path: '/', maxAge: 1000 * 60 * 60 * 24 * 365,
    });
    // Body must NOT echo the author token — the HttpOnly cookie above
    // is the only channel. Body advertises only the non-secret prefs
    // the client needs to wire up locally.
    res.send({ok: true, prefsHttp: tokenData.prefsHttp});
  })
}
