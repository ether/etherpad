'use strict';

import {strict as assert} from 'assert';
import {ensureAuthorTokenCookie} from '../../../node/utils/ensureAuthorTokenCookie';

type CookieCall = {name: string, value: string, opts: any};
const fakeRes = () => {
  const calls: CookieCall[] = [];
  return {
    calls,
    cookie(name: string, value: string, opts: any) { calls.push({name, value, opts}); },
  };
};

const cp = 'ep_';
const settingsStub = {cookie: {prefix: cp}} as any;

describe(__filename, function () {
  it('mints a fresh t.* token when the cookie is absent', function () {
    const req: any = {secure: false, cookies: {}, headers: {}};
    const res: any = fakeRes();
    const token = ensureAuthorTokenCookie(req, res, settingsStub);
    assert.ok(typeof token === 'string' && token.startsWith('t.'),
        `token=${token}`);
    assert.equal(res.calls.length, 1);
    assert.equal(res.calls[0].name, `${cp}token`);
    assert.equal(res.calls[0].value, token);
    assert.equal(res.calls[0].opts.httpOnly, true);
    assert.equal(res.calls[0].opts.sameSite, 'lax');
    assert.equal(res.calls[0].opts.path, '/');
  });

  it('reuses the cookie value and does not emit Set-Cookie when already set',
      function () {
        const req: any = {
          secure: false,
          cookies: {[`${cp}token`]: 't.abcdefghij1234567890'},
          headers: {},
        };
        const res: any = fakeRes();
        const token = ensureAuthorTokenCookie(req, res, settingsStub);
        assert.equal(token, 't.abcdefghij1234567890');
        assert.equal(res.calls.length, 0);
      });

  it('sets Secure when the request is HTTPS', function () {
    const req: any = {secure: true, cookies: {}, headers: {}};
    const res: any = fakeRes();
    ensureAuthorTokenCookie(req, res, settingsStub);
    assert.equal(res.calls[0].opts.secure, true);
  });

  it('uses SameSite=None when embedded cross-site (Sec-Fetch-Site: cross-site)',
      function () {
        const req: any = {
          secure: true,
          cookies: {},
          headers: {'sec-fetch-site': 'cross-site'},
        };
        const res: any = fakeRes();
        ensureAuthorTokenCookie(req, res, settingsStub);
        assert.equal(res.calls[0].opts.sameSite, 'none');
      });

  it('ignores an invalid existing cookie and mints a fresh one', function () {
    const req: any = {
      secure: false,
      cookies: {[`${cp}token`]: 'not-a-token'},
      headers: {},
    };
    const res: any = fakeRes();
    const token = ensureAuthorTokenCookie(req, res, settingsStub);
    assert.ok(token.startsWith('t.'));
    assert.equal(res.calls.length, 1);
    assert.notEqual(res.calls[0].value, 'not-a-token');
  });
});
