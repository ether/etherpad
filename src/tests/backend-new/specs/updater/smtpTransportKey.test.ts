import {describe, it, expect} from 'vitest';
import {smtpTransportKey} from '../../../../node/updater/index';

describe('smtpTransportKey', () => {
  // Regression for Qodo PR #7753 review: the nodemailer transport cache was
  // invalidated only on host change. Operators rotating SMTP credentials or
  // moving to a different port without changing host would keep using the
  // stale transport after reloadSettings().

  it('differs when port changes', () => {
    const base = {host: 'smtp.example.com', port: 587, secure: false, auth: null};
    expect(smtpTransportKey(base))
        .not.toBe(smtpTransportKey({...base, port: 465}));
  });

  it('differs when secure flag changes', () => {
    const base = {host: 'smtp.example.com', port: 587, secure: false, auth: null};
    expect(smtpTransportKey(base))
        .not.toBe(smtpTransportKey({...base, secure: true}));
  });

  it('differs when auth changes', () => {
    const base = {host: 'smtp.example.com', port: 587, secure: false,
                  auth: {user: 'a', pass: '1'}};
    expect(smtpTransportKey(base))
        .not.toBe(smtpTransportKey({...base, auth: {user: 'a', pass: '2'}}));
  });

  it('is stable for an unchanged config (cache hit on repeat calls)', () => {
    const cfg = {host: 'smtp.example.com', port: 587, secure: false,
                 auth: {user: 'a', pass: '1'}};
    expect(smtpTransportKey(cfg)).toBe(smtpTransportKey({...cfg}));
  });

  it('falls back to port 587 when port is unset or non-numeric', () => {
    expect(smtpTransportKey({host: 'h'}))
        .toBe(smtpTransportKey({host: 'h', port: 587}));
    expect(smtpTransportKey({host: 'h', port: 'not-a-number' as any}))
        .toBe(smtpTransportKey({host: 'h', port: 587}));
  });
});
