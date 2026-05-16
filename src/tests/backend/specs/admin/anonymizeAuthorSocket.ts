'use strict';

import {strict as assert} from 'assert';
import setCookieParser from 'set-cookie-parser';

const io = require('socket.io-client');
const common = require('../../common');
const settings = require('../../../../node/utils/Settings');
const authorManager = require('../../../../node/db/AuthorManager');

/**
 * Connects to the /settings admin namespace using cookie-based auth.
 * The /settings namespace reads is_admin from socket.conn.request.session,
 * which is populated by the express session middleware using the cookie passed
 * as a query parameter (socket.io-client on Node.js doesn't support cookies
 * natively).
 */
const adminSocket = async () => {
  // Ensure an admin user exists in settings.
  settings.users = settings.users || {};
  settings.users['test-admin'] = {password: 'test-admin-password', is_admin: true};

  // Fetch a page to establish an admin session and get the session cookie.
  // requireAuthentication must be true so the session gets the admin user.
  const savedRequireAuthentication = settings.requireAuthentication;
  settings.requireAuthentication = true;
  let res: any;
  try {
    res = await (common.agent as any)
        .get('/admin/')
        .auth('test-admin', 'test-admin-password');
  } finally {
    settings.requireAuthentication = savedRequireAuthentication;
  }

  // Extract the session cookie to pass to the socket.
  const resCookies = setCookieParser.parse(res, {map: true});
  const reqCookieHdr = Object.entries(resCookies)
      .map(([name, cookie]: [string, any]) =>
          `${name}=${encodeURIComponent(cookie.value)}`)
      .join('; ');

  const socket = io(`${common.baseUrl}/settings`, {
    forceNew: true,
    query: {cookie: reqCookieHdr},
  });

  await new Promise<void>((res, rej) => {
    const onErr = (err: any) => { socket.off('connect', onConn); rej(err); };
    const onConn = () => { socket.off('connect_error', onErr); res(); };
    socket.once('connect', onConn);
    socket.once('connect_error', onErr);
  });

  return socket;
};

const ask = (socket: any, evt: string, payload: any, replyEvt: string) =>
    new Promise<any>((res) => {
      socket.once(replyEvt, res);
      socket.emit(evt, payload);
    });

describe(__filename, function () {
  let socket: any;
  let originalFlag: boolean;
  let savedUsers: any;
  let savedRequireAuthentication: boolean;

  before(async function () {
    this.timeout(60000);
    await common.init();
    settings.gdprAuthorErasure = settings.gdprAuthorErasure || {enabled: false};
    originalFlag = settings.gdprAuthorErasure.enabled;
    settings.gdprAuthorErasure.enabled = true;
    savedUsers = settings.users;
    savedRequireAuthentication = settings.requireAuthentication;
    socket = await adminSocket();
  });

  after(function () {
    if (socket) socket.disconnect();
    settings.gdprAuthorErasure.enabled = originalFlag;
    // savedUsers and settings.users point at the same object — restoring
    // the reference is a no-op against the in-place mutation. Delete the
    // injected test-admin key so subsequent tests see a clean users map.
    if (settings.users) delete settings.users['test-admin'];
    settings.users = savedUsers;
    settings.requireAuthentication = savedRequireAuthentication;
  });

  it('authorLoad returns paginated rows', async function () {
    const tag = `sock-${Date.now()}`;
    await authorManager.createAuthorIfNotExistsFor(`m-${tag}`, `Sock ${tag}`);
    const res = await ask(socket, 'authorLoad',
        {pattern: tag, offset: 0, limit: 12, sortBy: 'name',
         ascending: true, includeErased: false},
        'results:authorLoad');
    assert.ok(res.total >= 1, JSON.stringify(res));
    assert.ok(res.results.some((r: any) => r.name === `Sock ${tag}`));
  });

  it('anonymizeAuthorPreview returns counters without flipping erased',
      async function () {
        const tag = `prev-${Date.now()}`;
        const {authorID} = await authorManager.createAuthorIfNotExistsFor(
            `m-${tag}`, `Prev ${tag}`);
        const preview = await ask(socket, 'anonymizeAuthorPreview',
            {authorID}, 'results:anonymizeAuthorPreview');
        assert.equal(preview.authorID, authorID);
        assert.ok(preview.removedExternalMappings >= 1);
        const rec = await authorManager.getAuthor(authorID);
        assert.equal(rec.erased, undefined,
            'preview must not flip erased');
      });

  it('anonymizeAuthor commits when the flag is enabled', async function () {
    const tag = `live-${Date.now()}`;
    const {authorID} = await authorManager.createAuthorIfNotExistsFor(
        `m-${tag}`, `Live ${tag}`);
    const res = await ask(socket, 'anonymizeAuthor',
        {authorID}, 'results:anonymizeAuthor');
    assert.equal(res.authorID, authorID);
    assert.ok(res.removedExternalMappings >= 1);
    const rec = await authorManager.getAuthor(authorID);
    assert.equal(rec.erased, true);
  });

  it('anonymizeAuthor returns {error: "disabled"} when flag is off',
      async function () {
        settings.gdprAuthorErasure.enabled = false;
        try {
          const tag = `disabled-${Date.now()}`;
          const {authorID} = await authorManager.createAuthorIfNotExistsFor(
              `m-${tag}`, `Off ${tag}`);
          const res = await ask(socket, 'anonymizeAuthor',
              {authorID}, 'results:anonymizeAuthor');
          assert.equal(res.error, 'disabled');
          const rec = await authorManager.getAuthor(authorID);
          assert.notEqual(rec.erased, true,
              'record should not be erased when flag is off');
        } finally {
          settings.gdprAuthorErasure.enabled = true;
        }
      });

  it('anonymizeAuthorPreview returns {error: "disabled"} when flag is off',
      async function () {
        // Per Qodo Compliance ID 6 ('new features behind a feature flag,
        // disabled by default') the preview event is also gated, not just
        // the live anonymizeAuthor. The page renders its disabled banner
        // off the socket reply when this fires.
        settings.gdprAuthorErasure.enabled = false;
        try {
          const tag = `prev-off-${Date.now()}`;
          const {authorID} = await authorManager.createAuthorIfNotExistsFor(
              `m-${tag}`, `PrevOff ${tag}`);
          const preview = await ask(socket, 'anonymizeAuthorPreview',
              {authorID}, 'results:anonymizeAuthorPreview');
          assert.equal(preview.error, 'disabled');
          assert.equal(preview.removedExternalMappings, undefined,
              'no counters should leak when the flag is off');
        } finally {
          settings.gdprAuthorErasure.enabled = true;
        }
      });

  it('authorLoad returns {error: "disabled"} when flag is off',
      async function () {
        settings.gdprAuthorErasure.enabled = false;
        try {
          const res = await ask(socket, 'authorLoad',
              {pattern: '', offset: 0, limit: 12, sortBy: 'name',
               ascending: true, includeErased: false},
              'results:authorLoad');
          assert.equal(res.error, 'disabled');
          assert.deepEqual(res.results, []);
        } finally {
          settings.gdprAuthorErasure.enabled = true;
        }
      });

  it('handlers do not crash on payload-less emits',
      async function () {
        // Pre-Qodo-fix the destructure `({authorID}: ...)` threw before
        // try/catch when client emitted with no payload. Both gated
        // handlers now accept `payload: any` and read defensively.
        const previewRes = await ask(socket, 'anonymizeAuthorPreview',
            undefined, 'results:anonymizeAuthorPreview');
        assert.ok(previewRes.error,
            `expected error, got ${JSON.stringify(previewRes)}`);
        const eraseRes = await ask(socket, 'anonymizeAuthor',
            undefined, 'results:anonymizeAuthor');
        assert.ok(eraseRes.error,
            `expected error, got ${JSON.stringify(eraseRes)}`);
      });
});
