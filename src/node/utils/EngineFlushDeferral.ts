// Engine.io socket flush deferral — #7756 / #7767 deeper investigation
// after the simple WS transport-level packing prototype (#7772) showed
// that the writeBuffer almost never accumulates because flush() drains
// immediately on `transport.writable === true`.
//
// engine.io's Socket.sendPacket(...) ends with:
//
//   this.writeBuffer.push(packet);
//   if (callback) this.packetsFn.push(callback);
//   this.flush();                                  // <-- synchronous
//
// flush() reads writeBuffer and hands it to transport.send. For
// WebSocket, transport.writable is true again within microseconds of
// each write, so each sendPacket() call drains a buffer of size 1. The
// transport.send([packets]) function then iterates packets and writes
// one WS frame per packet — which is what the polling transport's
// natural encodePayload batching avoids.
//
// This patch coalesces synchronous-task sendPacket calls onto a single
// microtask-scheduled flush. Inside the same JS task, multiple
// sendPacket() calls accumulate in writeBuffer; the queued microtask
// then calls flush() once with the whole batch. The transport's
// send([batch]) sees N > 1 packets and the WS payload-encoding fast
// path (also added by lever 8) coalesces them into one frame.
//
// Microtask deferral adds zero meaningful wall-clock latency:
// microtasks drain before the next macrotask, so any consumer waiting
// on the next setImmediate / setTimeout / I/O callback still sees the
// flush completed.
//
// Forward-compatible. Existing clients receive identical wire bytes
// because the engine.io packet encoding is unchanged; the difference
// is only how many engine.io packets share one transport-level send
// call. The WS transport's send([packets]) path is then where lever 8
// (or this patch's accompanying engine-packing branch) decides
// whether to ship them as N frames or one payload-encoded frame.
//
// Gated by settings.engineFlushDefer. Default off; production unaffected.

import log4js from 'log4js';

const logger = log4js.getLogger('engine-flush-defer');

let installed = false;

const SCHEDULED = Symbol('engineFlushScheduled');

export const installEngineFlushDeferral = (): void => {
  if (installed) return;

  let SocketProto: {sendPacket: (...a: unknown[]) => unknown};
  try {
    // Resolve engine.io through socket.io, and only via its public entry point:
    //   - engine.io is a transitive dependency of socket.io, so under pnpm's
    //     layout it is not resolvable from `src` at all (MODULE_NOT_FOUND), and
    //   - `engine.io/build/socket` is not in engine.io's `exports` map, so a deep
    //     require fails with ERR_PACKAGE_PATH_NOT_EXPORTED even when it is.
    // Resolving relative to socket.io also guarantees we patch the very copy
    // socket.io loaded, not a second one that a hoisting layout might provide.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const engineIo = require(require.resolve('engine.io', {paths: [require.resolve('socket.io')]}));
    SocketProto = engineIo.Socket.prototype;
  } catch (err: any) {
    logger.warn('engineFlushDefer is enabled but the engine.io Socket class could not be ' +
                `resolved, so the patch is NOT active: ${err && err.message || err}`);
    return;  // Leave `installed` false so a later boot path can retry.
  }
  if (typeof SocketProto.sendPacket !== 'function') {
    logger.warn('engine.io Socket shape unexpected; skipping flush deferral patch');
    return;  // Leave `installed` false so a later boot path can retry.
  }
  // Only after both require and shape check succeed do we record that the
  // patch is installed. Setting the flag before validation (the original
  // code) would have permanently disabled retries after a transient
  // require failure in test/CI environments where socket.io may load late.
  installed = true;

  // Re-implementing sendPacket inline rather than wrapping the original
  // so the single closing `this.flush()` becomes a microtask-coalesced
  // schedule. The body is a verbatim copy of engine.io 6.6.9's
  // implementation apart from that last line — engineFlushDeferral.ts pins the
  // upstream source with a fingerprint, so an engine.io upgrade that touches
  // sendPacket fails the test suite and forces a re-vet of this copy.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  SocketProto.sendPacket = function (this: any, type: any, data: any, options: any, callback: any) {
    if ('function' === typeof options) {
      callback = options;
      options = {};
    }
    if ('closing' === this.readyState || 'closed' === this.readyState) return;

    options = options || {};
    options.compress = options.compress !== false;
    const packet: any = {type, options};
    // Upstream uses a truthiness check, not `!== undefined`: a falsy payload is
    // deliberately not attached (encodePacket renders `type` alone for it).
    if (data) packet.data = data;
    this.emit('packetCreate', packet);
    this.writeBuffer.push(packet);
    if ('function' === typeof callback) this.packetsFn.push(callback);

    if (this[SCHEDULED]) return;
    this[SCHEDULED] = true;
    queueMicrotask(() => {
      this[SCHEDULED] = false;
      this.flush();
    });
  };

  logger.info('engine.io socket flush deferral enabled (#7756 / #7767)');
};
