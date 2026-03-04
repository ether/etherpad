'use strict';

import {applyToAttribution, applyToText, checkRep, joinAttributionLines, mutateAttributionLines, mutateTextLines, pack} from '../../../static/js/Changeset';
import AttributePool from '../../../static/js/AttributePool';
import {poolOrArray} from '../easysync-helper';
import {expect, describe,it } from "vitest";
import {SmartOpAssembler} from "../../../static/js/SmartOpAssembler";
import Op from "../../../static/js/Op";
import {StringAssembler} from "../../../static/js/StringAssembler";
import TextLinesMutator from "../../../static/js/TextLinesMutator";
import {numToString} from "../../../static/js/ChangesetUtils";

describe('easysync-mutations', function () {
  const applyMutations = (mu: TextLinesMutator, arrayOfArrays: any[]) => {
    arrayOfArrays.forEach((a) => {
      // @ts-ignore
      const result = mu[a[0]](...a.slice(1));
      if (a[0] === 'remove' && a[3]) {
        expect(result).to.equal(a[3]);
      }
    });
  };

  const mutationsToChangeset = (oldLen: number, arrayOfArrays: string[][]) => {
    const assem = new SmartOpAssembler();
    const op = new Op();
    const bank = new StringAssembler();
    let oldPos = 0;
    let newLen = 0;
    arrayOfArrays.forEach((a: any[]) => {
      if (a[0] === 'skip') {
        op.opcode = '=';
        op.chars = a[1];
        op.lines = (a[2] || 0);
        assem.append(op);
        oldPos += op.chars;
        newLen += op.chars;
      } else if (a[0] === 'remove') {
        op.opcode = '-';
        op.chars = a[1];
        op.lines = (a[2] || 0);
        assem.append(op);
        oldPos += op.chars;
      } else if (a[0] === 'insert') {
        op.opcode = '+';
        bank.append(a[1]);
        op.chars = a[1].length;
        op.lines = (a[2] || 0);
        assem.append(op);
        newLen += op.chars;
      }
    });
    newLen += oldLen - oldPos;
    assem.endDocument();
    return pack(oldLen, newLen, assem.toString(), bank.toString());
  };

  const runMutationTest = (testId: number, origLines: string[], muts:any, correct: string[]) => {
    it(`runMutationTest#${testId}`, async function () {
      let lines = origLines.slice();
      const mu = new TextLinesMutator(lines);
      applyMutations(mu, muts);
      mu.close();
      expect(lines).to.eql(correct);

      const inText = origLines.join('');
      const cs = mutationsToChangeset(inText.length, muts);
      lines = origLines.slice();
      mutateTextLines(cs, lines);
      expect(lines).to.eql(correct);

      const correctText = correct.join('');
      const outText = applyToText(cs, inText);
      expect(outText).to.equal(correctText);
    });
  };

  runMutationTest(1, ['apple\n', 'banana\n', 'cabbage\n', 'duffle\n', 'eggplant\n'], [
    ['remove', 1, 0, 'a'],
    ['insert', 'tu'],
    ['remove', 1, 0, 'p'],
    ['skip', 4, 1],
    ['skip', 7, 1],
    ['insert', 'cream\npie\n', 2],
    ['skip', 2],
    ['insert', 'bot'],
    ['insert', '\n', 1],
    ['insert', 'bu'],
    ['skip', 3],
    ['remove', 3, 1, 'ge\n'],
    ['remove', 6, 0, 'duffle'],
  ], ['tuple\n', 'banana\n', 'cream\n', 'pie\n', 'cabot\n', 'bubba\n', 'eggplant\n']);

  runMutationTest(2, ['apple\n', 'banana\n', 'cabbage\n', 'duffle\n', 'eggplant\n'], [
    ['remove', 1, 0, 'a'],
    ['remove', 1, 0, 'p'],
    ['insert', 'tu'],
    ['skip', 11, 2],
    ['insert', 'cream\npie\n', 2],
    ['skip', 2],
    ['insert', 'bot'],
    ['insert', '\n', 1],
    ['insert', 'bu'],
    ['skip', 3],
    ['remove', 3, 1, 'ge\n'],
    ['remove', 6, 0, 'duffle'],
  ], ['tuple\n', 'banana\n', 'cream\n', 'pie\n', 'cabot\n', 'bubba\n', 'eggplant\n']);

  runMutationTest(3, ['apple\n', 'banana\n', 'cabbage\n', 'duffle\n', 'eggplant\n'], [
    ['remove', 6, 1, 'apple\n'],
    ['skip', 15, 2],
    ['skip', 6],
    ['remove', 1, 1, '\n'],
    ['remove', 8, 0, 'eggplant'],
    ['skip', 1, 1],
  ], ['banana\n', 'cabbage\n', 'duffle\n']);

  runMutationTest(4, ['15\n'], [
    ['skip', 1],
    ['insert', '\n2\n3\n4\n', 4],
    ['skip', 2, 1],
  ], ['1\n', '2\n', '3\n', '4\n', '5\n']);

  runMutationTest(5, ['1\n', '2\n', '3\n', '4\n', '5\n'], [
    ['skip', 1],
    ['remove', 7, 4, '\n2\n3\n4\n'],
    ['skip', 2, 1],
  ], ['15\n']);

  runMutationTest(6, ['123\n', 'abc\n', 'def\n', 'ghi\n', 'xyz\n'], [
    ['insert', '0'],
    ['skip', 4, 1],
    ['skip', 4, 1],
    ['remove', 8, 2, 'def\nghi\n'],
    ['skip', 4, 1],
  ], ['0123\n', 'abc\n', 'xyz\n']);

  runMutationTest(7, ['apple\n', 'banana\n', 'cabbage\n', 'duffle\n', 'eggplant\n'], [
    ['remove', 6, 1, 'apple\n'],
    ['skip', 15, 2, true],
    ['skip', 6, 0, true],
    ['remove', 1, 1, '\n'],
    ['remove', 8, 0, 'eggplant'],
    ['skip', 1, 1, true],
  ], ['banana\n', 'cabbage\n', 'duffle\n']);

  it('mutatorHasMore', async function () {
    const lines = ['1\n', '2\n', '3\n', '4\n'];
    let mu;

    mu = new TextLinesMutator(lines);
    expect(mu.hasMore()).toBeTruthy();
    mu.skip(8, 4);
    expect(mu.hasMore()).toBeFalsy();
    mu.close();
    expect(mu.hasMore()).toBeFalsy();

    // still 1,2,3,4
    mu = new TextLinesMutator(lines);
    expect(mu.hasMore()).toBeTruthy();
    mu.remove(2, 1);
    expect(mu.hasMore()).toBeTruthy();
    mu.skip(2, 1);
    expect(mu.hasMore()).toBeTruthy();
    mu.skip(2, 1);
    expect(mu.hasMore()).toBeTruthy();
    mu.skip(2, 1);
    expect(mu.hasMore()).toBeFalsy();
    mu.insert('5\n', 1);
    expect(mu.hasMore()).toBeFalsy();
    mu.close();
    expect(mu.hasMore()).toBeFalsy();

    // 2,3,4,5 now
    mu = new TextLinesMutator(lines);
    expect(mu.hasMore()).toBeTruthy();
    mu.remove(6, 3);
    expect(mu.hasMore()).toBeTruthy();
    mu.remove(2, 1);
    expect(mu.hasMore()).toBeFalsy();
    mu.insert('hello\n', 1);
    expect(mu.hasMore()).toBeFalsy();
    mu.close();
    expect(mu.hasMore()).toBeFalsy();
  });

  describe('mutateTextLines', function () {
    const testMutateTextLines = (testId: number, cs: string, lines: string[], correctLines: string[]) => {
      it(`testMutateTextLines#${testId}`, async function () {
        const a = lines.slice();
        mutateTextLines(cs, a);
        expect(a).to.eql(correctLines);
      });
    };

    testMutateTextLines(1, 'Z:4<1|1-2-1|1+1+1$\nc', ['a\n', 'b\n'], ['\n', 'c\n']);
    testMutateTextLines(2, 'Z:4>0|1-2-1|2+3$\nc\n', ['a\n', 'b\n'], ['\n', 'c\n', '\n']);

    it('mutate keep only lines', async function () {
      const lines = ['1\n', '2\n', '3\n', '4\n'];
      const result = lines.slice();
      const cs = 'Z:8>0*0|1=2|2=2';

      mutateTextLines(cs, lines);
      expect(result).to.eql(lines);
    });
  });

  describe('mutate attributions', function () {
    const testPoolWithChars = (() => {
      const p = new AttributePool();
      p.putAttrib(['char', 'newline']);
      for (let i = 1; i < 36; i++) {
        p.putAttrib(['char', numToString(i)]);
      }
      p.putAttrib(['char', '']);
      return p;
    })();

    const runMutateAttributionTest = (testId: number, attribs: string[] | AttributePool, cs: string, alines: string[], outCorrect: string[]) => {
      it(`runMutateAttributionTest#${testId}`, async function () {
        const p = poolOrArray(attribs);
        const alines2 = Array.prototype.slice.call(alines);
        mutateAttributionLines(checkRep(cs), alines2, p);
        expect(alines2).to.eql(outCorrect);

        const removeQuestionMarks = (a: string) => a.replace(/\?/g, '');
        const inMerged = joinAttributionLines(alines.map(removeQuestionMarks));
        const correctMerged = joinAttributionLines(outCorrect.map(removeQuestionMarks));
        const mergedResult = applyToAttribution(cs, inMerged, p);
        expect(mergedResult).to.equal(correctMerged);
      });
    };

    // turn 123\n 456\n 789\n into 123\n 4<b>5</b>6\n 789\n
    runMutateAttributionTest(1,
        ['bold,true'], 'Z:c>0|1=4=1*0=1$', ['|1+4', '|1+4', '|1+4'],
        ['|1+4', '+1*0+1|1+2', '|1+4']);

    // make a document bold
    runMutateAttributionTest(2,
        ['bold,true'], 'Z:c>0*0|3=c$', ['|1+4', '|1+4', '|1+4'], ['*0|1+4', '*0|1+4', '*0|1+4']);

    // clear bold on document
    runMutateAttributionTest(3,
        ['bold,', 'bold,true'], 'Z:c>0*0|3=c$',
        ['*1+1+1*1+1|1+1', '+1*1+1|1+2', '*1+1+1*1+1|1+1'], ['|1+4', '|1+4', '|1+4']);

    // add a character on line 3 of a document with 5 blank lines, and make sure
    // the optimization that skips purely-kept lines is working; if any attribution string
    // with a '?' is parsed it will cause an error.
    runMutateAttributionTest(4,
        ['foo,bar', 'line,1', 'line,2', 'line,3', 'line,4', 'line,5'],
        'Z:5>1|2=2+1$x', ['?*1|1+1', '?*2|1+1', '*3|1+1', '?*4|1+1', '?*5|1+1'],
        ['?*1|1+1', '?*2|1+1', '+1*3|1+1', '?*4|1+1', '?*5|1+1']);

    // based on runMutationTest#1
    runMutateAttributionTest(5, testPoolWithChars,
        'Z:11>7-2*t+1*u+1|2=b|2+a=2*b+1*o+1*t+1*0|1+1*b+1*u+1=3|1-3-6$tucream\npie\nbot\nbu',
        [
          '*a+1*p+2*l+1*e+1*0|1+1',
          '*b+1*a+1*n+1*a+1*n+1*a+1*0|1+1',
          '*c+1*a+1*b+2*a+1*g+1*e+1*0|1+1',
          '*d+1*u+1*f+2*l+1*e+1*0|1+1',
          '*e+1*g+2*p+1*l+1*a+1*n+1*t+1*0|1+1',
        ],
        [
          '*t+1*u+1*p+1*l+1*e+1*0|1+1',
          '*b+1*a+1*n+1*a+1*n+1*a+1*0|1+1',
          '|1+6',
          '|1+4',
          '*c+1*a+1*b+1*o+1*t+1*0|1+1',
          '*b+1*u+1*b+2*a+1*0|1+1',
          '*e+1*g+2*p+1*l+1*a+1*n+1*t+1*0|1+1',
        ]);

    // based on runMutationTest#3
    runMutateAttributionTest(6, testPoolWithChars,
        'Z:11<f|1-6|2=f=6|1-1-8$', ['*a|1+6', '*b|1+7', '*c|1+8', '*d|1+7', '*e|1+9'],
        ['*b|1+7', '*c|1+8', '*d+6*e|1+1']);

    // based on runMutationTest#4
    runMutateAttributionTest(7, testPoolWithChars, 'Z:3>7=1|4+7$\n2\n3\n4\n',
        ['*1+1*5|1+2'], ['*1+1|1+1', '|1+2', '|1+2', '|1+2', '*5|1+2']);

    // based on runMutationTest#5
    runMutateAttributionTest(8, testPoolWithChars, 'Z:a<7=1|4-7$',
        ['*1|1+2', '*2|1+2', '*3|1+2', '*4|1+2', '*5|1+2'], ['*1+1*5|1+2']);

    // based on runMutationTest#6
    runMutateAttributionTest(9, testPoolWithChars, 'Z:k<7*0+1*10|2=8|2-8$0',
        [
          '*1+1*2+1*3+1|1+1',
          '*a+1*b+1*c+1|1+1',
          '*d+1*e+1*f+1|1+1',
          '*g+1*h+1*i+1|1+1',
          '?*x+1*y+1*z+1|1+1',
        ],
        ['*0+1|1+4', '|1+4', '?*x+1*y+1*z+1|1+1']);

    runMutateAttributionTest(10, testPoolWithChars, 'Z:6>4=1+1=1+1|1=1+1=1*0+1$abcd',
        ['|1+3', '|1+3'], ['|1+5', '+2*0+1|1+2']);


    runMutateAttributionTest(11, testPoolWithChars, 'Z:s>1|1=4=6|1+1$\n',
        ['*0|1+4', '*0|1+8', '*0+5|1+1', '*0|1+1', '*0|1+5', '*0|1+1', '*0|1+1', '*0|1+1', '|1+1'],
        [
          '*0|1+4',
          '*0+6|1+1',
          '*0|1+2',
          '*0+5|1+1',
          '*0|1+1',
          '*0|1+5',
          '*0|1+1',
          '*0|1+1',
          '*0|1+1',
          '|1+1',
        ]);
  });
});
