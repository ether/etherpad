'use strict';

import AttributePool from '../../../static/js/AttributePool';
import {checkRep, inverse, makeAttribution, mutateAttributionLines, mutateTextLines, splitAttributionLines} from '../../../static/js/Changeset';
import {randomMultiline, randomTestChangeset, poolOrArray} from '../easysync-helper.js';
import {expect, describe, it} from 'vitest'

describe('easysync-inverseRandom', function () {
  describe('inverse random', function () {
    const testInverseRandom = (randomSeed: number) => {
      it(`testInverseRandom#${randomSeed}`, async function () {
        const p = poolOrArray(['apple,', 'apple,true', 'banana,', 'banana,true']);

        const startText = `${randomMultiline(10, 20)}\n`;
        const alines =
          splitAttributionLines(makeAttribution(startText), startText);
        const lines = startText.slice(0, -1).split('\n').map((s) => `${s}\n`);

        const stylifier = randomTestChangeset(startText, true)[0];

        mutateAttributionLines(stylifier, alines, p);
        mutateTextLines(stylifier, lines);

        const changeset = randomTestChangeset(lines.join(''), true)[0];
        const inverseChangeset = inverse(changeset, lines, alines, p);

        const origLines = lines.slice();
        const origALines = alines.slice();

        mutateTextLines(changeset, lines);
        mutateAttributionLines(changeset, alines, p);
        mutateTextLines(inverseChangeset, lines);
        mutateAttributionLines(inverseChangeset, alines, p);
        expect(lines).to.eql(origLines);
        expect(alines).to.eql(origALines);
      });
    };

    for (let i = 0; i < 30; i++) testInverseRandom(i);
  });

  describe('inverse', function () {
    const testInverse = (testId: number, cs: string, lines: string | RegExpMatchArray | null, alines: string[] | { get: (idx: number) => string; }, pool: string[] | AttributePool, correctOutput: string) => {
      it(`testInverse#${testId}`, async function () {
        pool = poolOrArray(pool);
        const str = inverse(checkRep(cs), lines, alines, pool as AttributePool);
        expect(str).to.equal(correctOutput);
      });
    };

    // take "FFFFTTTTT" and apply "-FT--FFTT", the inverse of which is "--F--TT--"
    testInverse(1, 'Z:9>0=1*0=1*1=1=2*0=2*1|1=2$', null,
        ['+4*1+5'], ['bold,', 'bold,true'], 'Z:9>0=2*0=1=2*1=2$');
  });
});
