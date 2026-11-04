'use strict';

import {describe, it, expect, afterEach} from 'vitest';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {takeOverSignal} from '../../../node/utils/takeOverSignal';

describe('takeOverSignal', () => {
  const signal = 'SIGUSR2';
  const added: Array<(...args: any[]) => any> = [];
  afterEach(() => {
    for (const l of added.splice(0)) process.off(signal, l);
  });

  it('leaves the new listener as the only listener', () => {
    const a = () => {};
    const b = () => {};
    added.push(a, b);
    process.on(signal, a);
    const before = process.listeners(signal).length;
    const removed: any[] = [];
    takeOverSignal(signal, b, (s, l) => { removed.push(l); process.off(s, l); });
    expect(removed).toContain(a);
    expect(removed).not.toContain(b);
    expect(process.listeners(signal)).toEqual([b]);
    expect(before).toBeGreaterThan(0);
  });

  it('keeps a single registration if the listener was already subscribed', () => {
    const a = () => {};
    let calls = 0;
    const b = () => { calls++; };
    added.push(a, b);
    process.on(signal, b);
    process.on(signal, a);
    process.on(signal, b);
    takeOverSignal(signal, b);
    expect(process.listeners(signal)).toEqual([b]);
    process.emit(signal, signal);
    expect(calls).toBe(1);
  });

  // https://github.com/ether/etherpad/issues/8421
  // On Windows process.kill() terminates the process instead of raising a catchable signal.
  it.skipIf(process.platform === 'win32')('does not drop a signal that is pending while listeners are replaced', () => {
    const fixture = path.join(__dirname, '..', 'fixtures', 'signalDuringStartup.ts');
    const res = spawnSync(process.execPath, ['--import', 'tsx', fixture], {
      cwd: path.join(__dirname, '..', '..', '..'),
      encoding: 'utf8',
      timeout: 20000,
    });
    expect(res.stderr).toBe('');
    expect(res.stdout.trim()).toBe('handled');
    expect(res.status).toBe(0);
  });
});
