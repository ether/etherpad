import {ArgsExpressType} from "../../types/ArgsExpressType";
const db = require('../../db/DB');
import crypto from 'crypto'
import settings from '../../utils/Settings';


type TokenTransferRequest = {
  token: string;
  prefsHttp: string,
  createdAt?: number;
}

const tokenTransferKey = "tokenTransfer:";

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

    await db.set(`${tokenTransferKey}:${id}`, token);
    res.send({id});
  })

  app.get('/tokenTransfer/:token', async (req: any, res) => {
    const id = req.params.token;
    if (!id) {
      return res.status(400).send({error: 'Invalid request'});
    }

    const tokenData = await db.get(`${tokenTransferKey}:${id}`);
    if (!tokenData) {
      return res.status(404).send({error: 'Token not found'});
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
    res.send(tokenData);
  })
}
