'use strict';

import {strict as assert} from 'assert';

const common = require('../common');
const setCookieParser = require('set-cookie-parser');

describe(__filename, function () {
  let agent: any;

  before(async function () {
    this.timeout(60000);
    agent = await common.init();
  });

  const padPath = () => `/p/PR3_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  it('sets an HttpOnly token cookie on first visit', async function () {
    const res = await agent.get(padPath()).expect(200);
    const cookies = setCookieParser.parse(res, {map: true});
    const tokenEntry = Object.entries(cookies).find(([k]) => k.endsWith('token'));
    assert.ok(tokenEntry,
        `expected a token cookie; got: ${Object.keys(cookies).join(',')}`);
    const [, tokenCookie] = tokenEntry as [string, any];
    assert.match(tokenCookie.value, /^t\./);
    assert.equal(tokenCookie.httpOnly, true);
    assert.equal(String(tokenCookie.sameSite || '').toLowerCase(), 'lax');
    assert.equal(tokenCookie.path, '/');
  });

  it('reuses the cookie value on subsequent visits', async function () {
    const path = padPath();
    const first = await agent.get(path).expect(200);
    const firstCookies = setCookieParser.parse(first, {map: true});
    const firstEntry = Object.entries(firstCookies).find(([k]) => k.endsWith('token'));
    assert.ok(firstEntry);
    const [name, tokenCookie] = firstEntry as [string, any];

    const second = await agent.get(path)
        .set('Cookie', `${name}=${tokenCookie.value}`)
        .expect(200);
    const secondCookies = setCookieParser.parse(second, {map: true});
    const resent = Object.keys(secondCookies).find((k) => k.endsWith('token'));
    assert.equal(resent, undefined,
        `server should not re-send the token cookie when one is already present`);
  });
});
