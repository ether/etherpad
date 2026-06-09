'use strict';

/**
 * Single source of truth for the downstream wire-compatibility fixtures.
 *
 * Each vector is a self-contained changeset application: given `initialText`
 * and `pool`, applying `changeset` yields `resultText`. Downstream clients
 * (which reimplement Etherpad's changeset/attribpool decoders) consume the
 * exact same JSON and must reproduce `resultText`. See the Phase 1 plan
 * at docs/superpowers/plans/2026-06-09-downstream-client-compat-tests-phase1.md.
 *
 * Runnable as a CLI to (re)write src/tests/fixtures/wire-vectors.json:
 *   pnpm run vectors:gen
 */

import * as Changeset from '../../../../static/js/Changeset';
import AttributePool from '../../../../static/js/AttributePool';

export type WireVector = {
  name: string;
  initialText: string;
  changeset: string;
  pool: ReturnType<AttributePool['toJsonable']>;
  resultText: string;
};

const vector = (
  name: string,
  initialText: string,
  build: (pool: AttributePool) => string,
): WireVector => {
  const pool = new AttributePool();
  const changeset = build(pool);
  Changeset.checkRep(changeset);
  return {
    name,
    initialText,
    changeset,
    pool: pool.toJsonable(),
    resultText: Changeset.applyToText(changeset, initialText),
  };
};

export const generateVectors = (): WireVector[] => [
  vector('plain-insert', 'abc\n', () =>
    Changeset.makeSplice('abc\n', 3, 0, 'XYZ')),

  vector('plain-delete', 'abcdef\n', () =>
    Changeset.makeSplice('abcdef\n', 1, 3, '')),

  vector('formatted-insert', 'abc\n', (pool) =>
    Changeset.makeSplice('abc\n', 3, 0, 'bold', [['bold', 'true']], pool)),

  vector('multiline-insert', 'abc\n', () =>
    Changeset.makeSplice('abc\n', 3, 0, 'one\ntwo\n')),

  vector('attrib-reuse', 'abc\n', (pool) => {
    // Two formatted inserts sharing one pool entry exercises pool index reuse.
    const cs1 = Changeset.makeSplice('abc\n', 0, 0, 'A', [['bold', 'true']], pool);
    const mid = Changeset.applyToText(cs1, 'abc\n');
    const cs2 = Changeset.makeSplice(mid, mid.length - 1, 0, 'B', [['bold', 'true']], pool);
    return Changeset.compose(cs1, cs2, pool);
  }),
];

// CLI entry: write the canonical fixture to disk.
if (require.main === module) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require('fs');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const path = require('path');
  const out = path.join(__dirname, '../../../fixtures/wire-vectors.json');
  fs.mkdirSync(path.dirname(out), {recursive: true});
  fs.writeFileSync(out, `${JSON.stringify(generateVectors(), null, 2)}\n`);
  // eslint-disable-next-line no-console
  console.log(`wrote ${out}`);
}
