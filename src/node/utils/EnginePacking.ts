// Engine.io WebSocket transport-level packing — #7756 lever 8 prototype.
//
// Issue (see ether/etherpad#7767): engine.io's WebSocket transport sends one
// WS frame per engine.io packet, even when the engine.io socket has multiple
// packets buffered. The polling transport already coalesces — `send(packets)`
// goes through `encodePayload(packets)` and writes one HTTP response
// containing the whole payload. Under high emit rate the WS path is dominated
// by per-frame syscall overhead on the server and per-message callback
// overhead on the client.
//
// This module monkey-patches engine.io's WebSocket transport prototype so
// `send(packets)` with N > 1 packets goes through `encodePayload` and emits
// ONE WS frame containing the multi-packet payload. The frame contents are
// the same wire bytes the polling transport already uses, just delivered as
// a single WebSocket message instead of one frame per packet.
//
// Server-side only. The receiving client (engine.io-client, or anything
// reading the WS frames) must detect the engine.io-parser record separator
// (`\x1e`, U+001E) and call `decodePayload` instead of `decodePacket` when
// it's present. Newly-built clients (browser bundle + etherpad-cli-client
// patched separately) are forward-compatible: a single-packet frame never
// contains a raw `\x1e` (JSON escapes it to ``, and engine.io packet
// type bytes are '0'-'6' or empty for binary).
//
// Gated by settings.enginePacking. Production deployments are not affected
// by default. Enabling it without a forward-compatible client will silently
// break clients that receive a payload-encoded frame.

import log4js from 'log4js';

const logger = log4js.getLogger('engine-packing');

let installed = false;

/** Apply the patch once. Subsequent calls are no-ops. Idempotent so the
 *  module can be required from multiple boot paths without double-wrapping. */
export const installEngineWsPacking = (): void => {
  if (installed) return;
  installed = true;

  let WebSocketTransport: any;
  let encodePayload: any;
  try {
    // Resolve from inside engine.io's own dependency closure so we pick up
    // exactly the engine.io-parser the transport uses, not a duplicate copy.
    WebSocketTransport = require('engine.io/build/transports/websocket').WebSocket;
    encodePayload = require('engine.io-parser').encodePayload;
  } catch (err: any) {
    logger.warn(`Unable to install engine.io WS packing (modules not found): ${err && err.message || err}`);
    return;
  }
  if (typeof WebSocketTransport !== 'function' ||
      typeof WebSocketTransport.prototype !== 'object' ||
      typeof encodePayload !== 'function') {
    logger.warn('engine.io shape is unexpected; skipping WS packing patch');
    return;
  }

  const originalSend = WebSocketTransport.prototype.send;

  WebSocketTransport.prototype.send = function (packets: any[]) {
    // Single-packet sends keep the legacy fast path: per-frame encoding
    // including the pre-encoded-frame optimisation. Only fan-out bursts
    // (writeBuffer accumulated more than one packet between flushes) are
    // packed — for the steady state of a quiet pad, behaviour is identical
    // to the upstream implementation.
    if (!Array.isArray(packets) || packets.length < 2) {
      return originalSend.call(this, packets);
    }

    this.writable = false;
    const self = this;
    encodePayload(packets, (data: string) => {
      // Send the whole payload as ONE WS frame and fire the drain/ready
      // callbacks the upstream transport sends on the last packet. The
      // socket.io socket relies on `drain` to start its next flush.
      try {
        self.socket.send(data, self._onSentLast);
      } catch (err: any) {
        self.onError('write error', err && err.stack ? err.stack : err);
      }
    });
  };

  logger.info('engine.io WebSocket transport-level packing enabled (#7756 lever 8)');
};
