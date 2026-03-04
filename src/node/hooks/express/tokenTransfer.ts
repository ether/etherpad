import {ArgsExpressType} from "../../types/ArgsExpressType";
const db = require('../../db/DB');
import crypto from 'crypto'


type TokenTransferRequest = {
  token: string;
  prefsHttp: string,
  createdAt?: number;
}

const tokenTransferKey = "tokenTransfer:";

export const expressCreateServer =  (hookName:string, {app}:ArgsExpressType) => {
  app.post('/tokenTransfer', async (req, res) => {
    const token = req.body as TokenTransferRequest;
    if (!token || !token.token) {
      return res.status(400).send({error: 'Invalid request'});
    }

    const id = crypto.randomUUID()
    token.createdAt = Date.now();

    await db.set(`${tokenTransferKey}:${id}`, token)
    res.send({id});
  })

  app.get('/tokenTransfer/:token', async (req, res) => {
    const id = req.params.token;
    if (!id) {
      return res.status(400).send({error: 'Invalid request'});
    }

    const tokenData = await db.get(`${tokenTransferKey}:${id}`);
    if (!tokenData) {
      return res.status(404).send({error: 'Token not found'});
    }

    const token = await db.get(`${tokenTransferKey}:${id}`)

    res.cookie('token', tokenData.token, {path: '/', maxAge: 1000*60*60*24*365});
    res.cookie('prefsHttp', tokenData.prefsHttp, {path: '/', maxAge: 1000*60*60*24*365});
    res.send(token);
  })
}
