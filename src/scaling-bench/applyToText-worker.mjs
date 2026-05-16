// Worker thread for applyToText offload microbenchmark.
// Loads Changeset.ts via tsx so we exercise the real engine, not a
// stub.

import {parentPort} from 'node:worker_threads';

const {applyToText} = await import('../static/js/Changeset.ts');

parentPort.on('message', ({id, cs, str}) => {
  try {
    const result = applyToText(cs, str);
    parentPort.postMessage({id, result});
  } catch (e) {
    parentPort.postMessage({id, error: e && e.message || String(e)});
  }
});
