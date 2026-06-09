'use strict';

/**
 * Guards the downstream wire-format contract:
 *  - the committed fixture exactly matches a fresh regeneration (any drift is a
 *    deliberate wire change and must be re-generated + reviewed in the same PR), and
 *  - every vector is internally consistent under core's own Changeset engine.
 */

const assert = require('assert').strict;
import fs from 'fs';
import path from 'path';
import * as Changeset from '../../../../static/js/Changeset';
import {generateVectors} from './generate-vectors';

const fixturePath = path.join(__dirname, '../../../fixtures/wire-vectors.json');

describe(__filename, function () {
  it('committed fixture matches a fresh regeneration', function () {
    const committed = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
    const fresh = generateVectors();
    assert.deepEqual(committed, fresh,
      'wire-vectors.json is stale — run `pnpm run vectors:gen` and commit the result');
  });

  it('every vector applies to its result under core Changeset', function () {
    for (const v of generateVectors()) {
      Changeset.checkRep(v.changeset);
      assert.equal(Changeset.applyToText(v.changeset, v.initialText), v.resultText,
        `vector ${v.name} result mismatch`);
    }
  });
});
