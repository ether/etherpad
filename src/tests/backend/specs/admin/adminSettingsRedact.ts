'use strict';

import {strict as assert} from 'assert';
import {redactSettings} from '../../../../node/utils/AdminSettingsRedact';

describe('AdminSettingsRedact', function () {
  it('returns a deep clone, never mutates input', function () {
    const input = {dbSettings: {password: 'secret'}};
    const out = redactSettings(input) as any;
    assert.equal(input.dbSettings.password, 'secret');
    assert.equal(out.dbSettings.password, '[REDACTED]');
    assert.notEqual(out.dbSettings, input.dbSettings);
  });

  it('redacts users.*.password and users.*.passwordHash', function () {
    const out = redactSettings({
      users: {
        admin: {password: 'p1', is_admin: true},
        bob: {passwordHash: 'bcrypt$...'},
      },
    }) as any;
    assert.equal(out.users.admin.password, '[REDACTED]');
    assert.equal(out.users.admin.is_admin, true);
    assert.equal(out.users.bob.passwordHash, '[REDACTED]');
  });

  it('redacts users.*.hash (older spelling)', function () {
    const out = redactSettings({users: {alice: {hash: 'old$...'}}}) as any;
    assert.equal(out.users.alice.hash, '[REDACTED]');
  });

  it('redacts dbSettings.password and dbSettings.user', function () {
    const out = redactSettings({
      dbSettings: {
        host: 'localhost',
        user: 'etherpad',
        password: 'secret',
        filename: '/data/etherpad.db',
      },
    }) as any;
    assert.equal(out.dbSettings.password, '[REDACTED]');
    assert.equal(out.dbSettings.user, '[REDACTED]');
    assert.equal(out.dbSettings.host, 'localhost');
    assert.equal(out.dbSettings.filename, '/data/etherpad.db');
  });

  it('redacts sso.clients[*].client_secret and .secret', function () {
    const out = redactSettings({
      sso: {
        clients: [
          {client_id: 'app1', client_secret: 'shhh'},
          {client_id: 'app2', secret: 'older-style'},
        ],
      },
    }) as any;
    assert.equal(out.sso.clients[0].client_secret, '[REDACTED]');
    assert.equal(out.sso.clients[0].client_id, 'app1');
    assert.equal(out.sso.clients[1].secret, '[REDACTED]');
    assert.equal(out.sso.clients[1].client_id, 'app2');
  });

  it('redacts top-level sessionKey', function () {
    const out = redactSettings({sessionKey: 'sign-me'}) as any;
    assert.equal(out.sessionKey, '[REDACTED]');
  });

  it('emits [REDACTED] sentinel for null secret values', function () {
    const out = redactSettings({dbSettings: {password: null}}) as any;
    assert.equal(out.dbSettings.password, '[REDACTED]');
  });

  it('drops functions and other non-serialisable values', function () {
    const out = redactSettings({
      port: 9001,
      reloadSettings: () => {},
      dbSettings: {password: 'x'},
    }) as any;
    assert.equal(out.port, 9001);
    assert.equal(out.reloadSettings, undefined);
    assert.equal(out.dbSettings.password, '[REDACTED]');
  });

  it('leaves non-sensitive keys untouched', function () {
    const input = {
      port: 9001,
      ip: '0.0.0.0',
      loglevel: 'INFO',
      trustProxy: false,
      defaultPadText: 'Welcome!',
    };
    const out = redactSettings(input) as any;
    assert.deepEqual(out, input);
  });

  it('only matches the exact JSON path, not deeper matches', function () {
    const out = redactSettings({
      sso: {clients: [{nested: {client_secret: 'nope'}}]},
    }) as any;
    assert.equal(out.sso.clients[0].nested.client_secret, 'nope');
  });
});
