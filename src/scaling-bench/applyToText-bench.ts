// Microbenchmark for worker-thread offload of Changeset.applyToText.
// Question: at what (textSize, edit-complexity) does shipping work to
// a worker thread become net-positive vs running synchronously on the
// main thread? Worker dispatch adds postMessage + structured clone +
// scheduler hop. We need to know if that cost exceeds the saved CPU.

import {Worker} from 'node:worker_threads';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {applyToText, makeSplice} from '../static/js/Changeset';

const __dir = path.dirname(fileURLToPath(import.meta.url));

// Make a roughly realistic pad text. Each "paragraph" ~80 chars + newline
// matches the shape of editor-produced content.
const makeText = (sizeBytes: number): string => {
  const para = 'The quick brown fox jumps over the lazy dog and then writes some collaborative\n';
  const repeats = Math.ceil(sizeBytes / para.length);
  return para.repeat(repeats).slice(0, sizeBytes);
};

// A small typing-style edit: single char insertion mid-document.
const makeSmallEdit = (text: string): string =>
  makeSplice(text, Math.floor(text.length / 2), 0, 'x');

// A paragraph-paste edit: ~500 char insert near end.
const makePasteEdit = (text: string): string =>
  makeSplice(text, Math.floor(text.length * 0.9), 0,
    'A whole new paragraph of inserted text. '.repeat(12));

type WorkerReq = {id: number; cs: string; str: string};
type WorkerResp = {id: number; result?: string; error?: string};

const startWorker = (workerPath: string) => {
  const w = new Worker(workerPath);
  const pending = new Map<number, {resolve: (s: string) => void; reject: (e: Error) => void}>();
  w.on('message', (msg: WorkerResp) => {
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.error) p.reject(new Error(msg.error));
    else p.resolve(msg.result!);
  });
  let nextId = 0;
  const run = (cs: string, str: string): Promise<string> => {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, {resolve, reject});
      const req: WorkerReq = {id, cs, str};
      w.postMessage(req);
    });
  };
  return {w, run};
};

const time = async (label: string, n: number, fn: () => Promise<unknown> | unknown) => {
  // Warmup
  for (let i = 0; i < Math.min(50, n); i++) await fn();
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < n; i++) await fn();
  const t1 = process.hrtime.bigint();
  const ns = Number(t1 - t0);
  const perCallUs = ns / n / 1000;
  console.log(`  ${label.padEnd(28)} ${perCallUs.toFixed(2).padStart(8)} µs/call  (n=${n})`);
  return perCallUs;
};

const main = async () => {
  console.log('applyToText sync vs worker microbenchmark — Node', process.version, '\n');

  const workerPath = path.join(__dir, 'applyToText-worker.mjs');
  const {w, run} = startWorker(workerPath);

  const sizes = [
    {label: '1 KB',   bytes: 1_000},
    {label: '10 KB',  bytes: 10_000},
    {label: '100 KB', bytes: 100_000},
    {label: '500 KB', bytes: 500_000},
    {label: '2 MB',   bytes: 2_000_000},
  ];

  for (const sz of sizes) {
    const text = makeText(sz.bytes);
    const smallCs = makeSmallEdit(text);
    const pasteCs = makePasteEdit(text);
    console.log(`\n--- text size: ${sz.label} (${text.length} chars) ---`);
    const syncSmall  = await time('sync   small-edit',  500, () => applyToText(smallCs, text));
    const workerSmall = await time('worker small-edit',  500, () => run(smallCs, text));
    const syncPaste  = await time('sync   paste-edit',  300, () => applyToText(pasteCs, text));
    const workerPaste = await time('worker paste-edit',  300, () => run(pasteCs, text));
    const breakeven = (label: string, sync: number, worker: number) => {
      const delta = worker - sync;
      const sign = delta < 0 ? '+' : '-';
      console.log(`  → ${label}: worker ${sign}${Math.abs(delta).toFixed(1)} µs vs sync (${(delta/sync*100).toFixed(0)}%)`);
    };
    breakeven('small', syncSmall, workerSmall);
    breakeven('paste', syncPaste, workerPaste);
  }

  await w.terminate();
};

main().catch((e) => { console.error(e); process.exit(1); });
