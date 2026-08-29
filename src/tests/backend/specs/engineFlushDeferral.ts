'use strict';

/**
 * Tests for the opt-in engine.io flush deferral (settings.engineFlushDefer).
 *
 * Two jobs:
 *  1. Prove the patch actually installs and coalesces. The first cut resolved the
 *     Socket class via `require('engine.io/build/socket')`, which cannot work:
 *     engine.io is a transitive dependency of socket.io (not resolvable from
 *     `src` under pnpm) and `build/socket` is not in its `exports` map. The
 *     failure was caught and logged, so the feature was silently inert.
 *  2. Pin engine.io's own sendPacket source. The patch re-implements that method,
 *     so an engine.io upgrade that changes it must fail here and force a re-vet
 *     rather than silently diverging.
 */

const assert = require('assert').strict;
const crypto = require('crypto');
const {installEngineFlushDeferral} = require('../../../node/utils/EngineFlushDeferral');

// sha256 of engine.io 6.6.9's Socket.prototype.sendPacket source. Update this
// ONLY together with a re-read of the upstream method against the copy in
// EngineFlushDeferral.ts.
const PINNED_SEND_PACKET_SHA =
    'a94abb8dd747d4f55bc7611143b185d384463afd5ee9f006a5cde5a1851c0a05';

const engineIoSocketProto = () => {
  const path = require.resolve('engine.io', {paths: [require.resolve('socket.io')]});
  return require(path).Socket.prototype;
};

// Minimal stand-in for an engine.io Socket: the patch only touches these.
const fakeSocket = () => ({
  readyState: 'open',
  writeBuffer: [] as any[],
  packetsFn: [] as any[],
  flushed: 0,
  flushedSizes: [] as number[],
  emit() {},
  flush() {
    this.flushed++;
    this.flushedSizes.push(this.writeBuffer.length);
    this.writeBuffer = [];
  },
});

describe(__filename, function () {
  let sendPacket: any;
  let upstreamSendPacket: any;

  before(function () {
    // Capture upstream BEFORE patching, so the drift check below compares against
    // the real engine.io implementation.
    upstreamSendPacket = engineIoSocketProto().sendPacket;
    installEngineFlushDeferral();
    sendPacket = engineIoSocketProto().sendPacket;
  });

  after(function () {
    // The patch mutates a shared prototype, so leaving it in place would silently
    // run every later spec in the suite with the feature enabled.
    engineIoSocketProto().sendPacket = upstreamSendPacket;
  });

  it('installs onto the engine.io copy socket.io actually loaded', function () {
    // The bug this guards: a resolution failure downgraded to a warning, leaving
    // the stock synchronous implementation in place.
    assert.match(sendPacket.toString(), /queueMicrotask/,
        'engineFlushDefer did not patch engine.io Socket.prototype.sendPacket');
  });

  it('coalesces packets sent in one task into a single flush', async function () {
    const s = fakeSocket();
    sendPacket.call(s, 'message', 'a');
    sendPacket.call(s, 'message', 'b');
    sendPacket.call(s, 'message', 'c');
    assert.equal(s.flushed, 0, 'flush must not happen synchronously');
    assert.equal(s.writeBuffer.length, 3, 'packets accumulate in writeBuffer');

    await Promise.resolve();
    assert.equal(s.flushed, 1, 'exactly one flush per task');
    assert.deepEqual(s.flushedSizes, [3], 'the flush carries the whole batch');
  });

  it('preserves packet order and payloads', async function () {
    const s = fakeSocket();
    const seen: any[] = [];
    s.flush = function () { seen.push(...this.writeBuffer.map((p: any) => p.data)); };
    for (const d of ['1', '2', '3']) sendPacket.call(s, 'message', d);
    await Promise.resolve();
    assert.deepEqual(seen, ['1', '2', '3']);
  });

  it('schedules a fresh flush for the next task', async function () {
    const s = fakeSocket();
    sendPacket.call(s, 'message', 'a');
    await Promise.resolve();
    sendPacket.call(s, 'message', 'b');
    await Promise.resolve();
    assert.equal(s.flushed, 2);
    assert.deepEqual(s.flushedSizes, [1, 1]);
  });

  it('drops packets once the socket is closing or closed', async function () {
    for (const readyState of ['closing', 'closed']) {
      const s = fakeSocket();
      s.readyState = readyState;
      sendPacket.call(s, 'message', 'a');
      await Promise.resolve();
      assert.equal(s.writeBuffer.length, 0, `${readyState}: nothing queued`);
      assert.equal(s.flushed, 0, `${readyState}: nothing flushed`);
    }
  });

  it('keeps send callbacks, and treats a callback in the options slot as one', async function () {
    const s = fakeSocket();
    const cb = () => {};
    sendPacket.call(s, 'message', 'a', cb);
    assert.deepEqual(s.packetsFn, [cb], 'callback passed in the options position');
    assert.equal(s.writeBuffer[0].options.compress, true, 'compression defaults to on');
    await Promise.resolve();
  });

  it('attaches only truthy payloads, like upstream', async function () {
    const s = fakeSocket();
    sendPacket.call(s, 'pong');
    sendPacket.call(s, 'message', '');
    assert.equal('data' in s.writeBuffer[0], false, 'no data for a bare pong');
    assert.equal('data' in s.writeBuffer[1], false, 'no data for an empty payload');
    await Promise.resolve();
  });

  it('engine.io sendPacket is unchanged since the copy was vetted', function () {
    assert.doesNotMatch(upstreamSendPacket.toString(), /queueMicrotask/,
        'the patch was already installed before this spec ran, so upstream could not ' +
        'be captured — run this spec in its own process to check for drift');
    const sha = crypto.createHash('sha256').update(upstreamSendPacket.toString()).digest('hex');
    assert.equal(sha, PINNED_SEND_PACKET_SHA,
        'engine.io Socket.prototype.sendPacket changed upstream — re-vet the copy in ' +
        'EngineFlushDeferral.ts against the new implementation, then update ' +
        `PINNED_SEND_PACKET_SHA to ${sha}`);
  });
});
