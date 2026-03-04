'use strict';

import {subattribution} from '../../../static/js/Changeset';
import {expect, describe, it} from 'vitest';
describe('easysync-subAttribution', function () {
  const testSubattribution = (testId: number, astr: string, start: number, end: number | undefined, correctOutput: string) => {
    it(`subattribution#${testId}`, async function () {
      const str = subattribution(astr, start, end);
      expect(str).to.equal(correctOutput);
    });
  };

  testSubattribution(1, '+1', 0, 0, '');
  testSubattribution(2, '+1', 0, 1, '+1');
  testSubattribution(3, '+1', 0, undefined, '+1');
  testSubattribution(4, '|1+1', 0, 0, '');
  testSubattribution(5, '|1+1', 0, 1, '|1+1');
  testSubattribution(6, '|1+1', 0, undefined, '|1+1');
  testSubattribution(7, '*0+1', 0, 0, '');
  testSubattribution(8, '*0+1', 0, 1, '*0+1');
  testSubattribution(9, '*0+1', 0, undefined, '*0+1');
  testSubattribution(10, '*0|1+1', 0, 0, '');
  testSubattribution(11, '*0|1+1', 0, 1, '*0|1+1');
  testSubattribution(12, '*0|1+1', 0, undefined, '*0|1+1');
  testSubattribution(13, '*0+2+1*1+3', 0, 1, '*0+1');
  testSubattribution(14, '*0+2+1*1+3', 0, 2, '*0+2');
  testSubattribution(15, '*0+2+1*1+3', 0, 3, '*0+2+1');
  testSubattribution(16, '*0+2+1*1+3', 0, 4, '*0+2+1*1+1');
  testSubattribution(17, '*0+2+1*1+3', 0, 5, '*0+2+1*1+2');
  testSubattribution(18, '*0+2+1*1+3', 0, 6, '*0+2+1*1+3');
  testSubattribution(19, '*0+2+1*1+3', 0, 7, '*0+2+1*1+3');
  testSubattribution(20, '*0+2+1*1+3', 0, undefined, '*0+2+1*1+3');
  testSubattribution(21, '*0+2+1*1+3', 1, undefined, '*0+1+1*1+3');
  testSubattribution(22, '*0+2+1*1+3', 2, undefined, '+1*1+3');
  testSubattribution(23, '*0+2+1*1+3', 3, undefined, '*1+3');
  testSubattribution(24, '*0+2+1*1+3', 4, undefined, '*1+2');
  testSubattribution(25, '*0+2+1*1+3', 5, undefined, '*1+1');
  testSubattribution(26, '*0+2+1*1+3', 6, undefined, '');
  testSubattribution(27, '*0+2+1*1|1+3', 0, 1, '*0+1');
  testSubattribution(28, '*0+2+1*1|1+3', 0, 2, '*0+2');
  testSubattribution(29, '*0+2+1*1|1+3', 0, 3, '*0+2+1');
  testSubattribution(30, '*0+2+1*1|1+3', 0, 4, '*0+2+1*1+1');
  testSubattribution(31, '*0+2+1*1|1+3', 0, 5, '*0+2+1*1+2');
  testSubattribution(32, '*0+2+1*1|1+3', 0, 6, '*0+2+1*1|1+3');
  testSubattribution(33, '*0+2+1*1|1+3', 0, 7, '*0+2+1*1|1+3');
  testSubattribution(34, '*0+2+1*1|1+3', 0, undefined, '*0+2+1*1|1+3');
  testSubattribution(35, '*0+2+1*1|1+3', 1, undefined, '*0+1+1*1|1+3');
  testSubattribution(36, '*0+2+1*1|1+3', 2, undefined, '+1*1|1+3');
  testSubattribution(37, '*0+2+1*1|1+3', 3, undefined, '*1|1+3');
  testSubattribution(38, '*0+2+1*1|1+3', 4, undefined, '*1|1+2');
  testSubattribution(39, '*0+2+1*1|1+3', 5, undefined, '*1|1+1');
  testSubattribution(40, '*0+2+1*1|1+3', 1, 5, '*0+1+1*1+2');
  testSubattribution(41, '*0+2+1*1|1+3', 2, 6, '+1*1|1+3');
  testSubattribution(42, '*0+2+1*1+3', 2, 6, '+1*1+3');
});
