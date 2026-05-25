/**
 * Coverage for /tokenTransfer/:token: TTL, single-use, and the
 * response-body shape (cookie-only — no `token` field in JSON).
 */

import * as common from '../common.js';
import settings from '../../../node/utils/Settings.js';
import DB from '../../../node/db/DB.js';

let agent: any;

// Match the value in src/node/hooks/express/tokenTransfer.ts. Kept here as a
// constant rather than importing so the test will fail loudly if the
// production constant is ever changed (a "5 minute" expectation downstream
// might depend on it).
const TRANSFER_TTL_MS = 5 * 60 * 1000;

describe(__filename, function () {
  before(async function () { agent = await common.init(); });

  // Each test plants a fresh author cookie because POST /tokenTransfer reads
  // the token off the request's own cookie jar. Using a literal value (not a
  // real Etherpad-minted token) is fine for this test surface — the handler
  // does not validate the token's shape.
  const cookiePrefix = (): string => settings.cookie.prefix || '';
  const authorCookie = (val: string) => `${cookiePrefix()}token=${val}`;

  const postTransfer = async (
      tokenValue: string, body: object = {}): Promise<string> => {
    const res = await agent.post('/tokenTransfer')
        .set('Cookie', authorCookie(tokenValue))
        .send(body)
        .expect(200);
    if (typeof res.body.id !== 'string' || !res.body.id) {
      throw new Error(
          `expected {id: string} from POST /tokenTransfer, got ${
            JSON.stringify(res.body)}`);
    }
    return res.body.id;
  };

  describe('happy path', function () {
    it('POST returns an id and GET sets the HttpOnly cookie', async function () {
      const id = await postTransfer('t.abc123', {prefsHttp: 'theme=dark'});
      const res = await agent.get(`/tokenTransfer/${id}`).expect(200);

      // The response body must not contain the raw `token` field —
      // the HttpOnly cookie set below is the only delivery channel.
      if ('token' in res.body) {
        throw new Error(
            `response body leaks the author token: ${JSON.stringify(res.body)}`);
      }
      if (res.body.ok !== true) {
        throw new Error(
            `expected {ok:true,...} body, got ${JSON.stringify(res.body)}`);
      }
      if (res.body.prefsHttp !== 'theme=dark') {
        throw new Error(
            `expected prefsHttp to round-trip, got ${JSON.stringify(res.body)}`);
      }

      // The HttpOnly author cookie should be set on the response.
      const setCookie = (res.headers['set-cookie'] || []) as string[];
      const tokenCookie = setCookie.find(
          (c) => c.startsWith(`${cookiePrefix()}token=`));
      if (!tokenCookie) {
        throw new Error(
            `expected Set-Cookie for ${cookiePrefix()}token, got ${
              JSON.stringify(setCookie)}`);
      }
      if (!/HttpOnly/i.test(tokenCookie)) {
        throw new Error(
            `expected HttpOnly on author cookie, got ${tokenCookie}`);
      }
      // The HttpOnly cookie should carry the original token value (URL-encoded
      // by supertest; do a substring check to keep the assertion stable).
      if (!tokenCookie.includes('t.abc123')) {
        throw new Error(
            `expected author cookie to carry the original token, got ${
              tokenCookie}`);
      }
    });
  });

  describe('single-use enforcement', function () {
    it('a second GET with the same id returns 404', async function () {
      const id = await postTransfer('t.single-use');
      await agent.get(`/tokenTransfer/${id}`).expect(200);
      // Second redemption: the record must be gone.
      await agent.get(`/tokenTransfer/${id}`).expect(404);
    });
  });

  describe('TTL enforcement', function () {
    it('a GET more than TRANSFER_TTL_MS after POST returns 410', async function () {
      const id = await postTransfer('t.expired');
      // Backdate the stored record by mutating it directly. Going through
      // setTimeout for 5+ minutes inside a unit test isn't viable, and the
      // production code path reads createdAt off the DB record — so it's
      // sufficient to put an expired createdAt in place.
      const key = `tokenTransfer::${id}`;
      const record = await (DB as any).get(key);
      if (!record) {
        throw new Error(
            `expected a DB record at ${key}; got ${JSON.stringify(record)}`);
      }
      record.createdAt = Date.now() - (TRANSFER_TTL_MS + 1000);
      await (DB as any).set(key, record);

      const res = await agent.get(`/tokenTransfer/${id}`).expect(410);
      if (!/expired/i.test(res.body.error || '')) {
        throw new Error(
            `expected an expiry error, got ${JSON.stringify(res.body)}`);
      }
      // After an expired GET the record should also be gone (the new code
      // removes the row before checking the TTL so an expired id cannot
      // be tried again).
      const after = await (DB as any).get(key);
      if (after != null) {
        throw new Error(
            `expected the DB record to be removed after an expired GET; ` +
            `still present: ${JSON.stringify(after)}`);
      }
    });

    it('a record with no createdAt is treated as expired', async function () {
      // Simulate a legacy record that pre-dates this code path (the original
      // handler made createdAt optional and inserted it inconsistently).
      const id = 'legacy-record-' + Date.now();
      const key = `tokenTransfer::${id}`;
      await (DB as any).set(key, {token: 't.legacy', prefsHttp: ''});
      await agent.get(`/tokenTransfer/${id}`).expect(410);
    });
  });

  describe('POST validation', function () {
    it('returns 400 when no author cookie is present', async function () {
      await agent.post('/tokenTransfer')
          .send({})
          .expect(400);
    });
  });

  describe('GET validation', function () {
    it('returns 404 for an unknown id', async function () {
      await agent.get(`/tokenTransfer/${'does-not-exist-' + Date.now()}`)
          .expect(404);
    });
  });
});
