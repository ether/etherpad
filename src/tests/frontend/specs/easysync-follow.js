'use strict';

const Changeset = require('../../../static/js/Changeset');
const AttributePool = require('../../../static/js/AttributePool');
const {randomMultiline, randomTestChangeset} = require('../easysync-helper.js');

describe('easysync-follow', function () {
  describe('follow & compose', function () {
    const testFollow = (randomSeed) => {
      it(`testFollow#${randomSeed}`, async function () {
        const p = new AttributePool();

        const startText = `${randomMultiline(10, 20)}\n`;

        const cs1 = randomTestChangeset(startText)[0];
        const cs2 = randomTestChangeset(startText)[0];

        const afb = Changeset.checkRep(Changeset.follow(cs1, cs2, false, p));
        const bfa = Changeset.checkRep(Changeset.follow(cs2, cs1, true, p));

        const merge1 = Changeset.checkRep(Changeset.compose(cs1, afb));
        const merge2 = Changeset.checkRep(Changeset.compose(cs2, bfa));

        expect(merge2).to.equal(merge1);
      });
    };

    for (let i = 0; i < 30; i++) testFollow(i);
  });

  describe('followAttributes & composeAttributes', function () {
    const p = new AttributePool();
    p.putAttrib(['x', '']);
    p.putAttrib(['x', 'abc']);
    p.putAttrib(['x', 'def']);
    p.putAttrib(['y', '']);
    p.putAttrib(['y', 'abc']);
    p.putAttrib(['y', 'def']);
    let n = 0;

    const testFollow = (a, b, afb, bfa, merge) => {
      it(`manual #${++n}`, async function () {
        expect(Changeset.exportedForTestingOnly.followAttributes(a, b, p)).to.equal(afb);
        expect(Changeset.exportedForTestingOnly.followAttributes(b, a, p)).to.equal(bfa);
        expect(Changeset.composeAttributes(a, afb, true, p)).to.equal(merge);
        expect(Changeset.composeAttributes(b, bfa, true, p)).to.equal(merge);
      });
    };

    testFollow('', '', '', '', '');
    testFollow('*0', '', '', '*0', '*0');
    testFollow('*0', '*0', '', '', '*0');
    testFollow('*0', '*1', '', '*0', '*0');
    testFollow('*1', '*2', '', '*1', '*1');
    testFollow('*0*1', '', '', '*0*1', '*0*1');
    testFollow('*0*4', '*2*3', '*3', '*0', '*0*3');
    testFollow('*0*4', '*2', '', '*0*4', '*0*4');
  });

  describe('chracterRangeFollow', function () {
    const testCharacterRangeFollow = (testId, cs, oldRange, insertionsAfter, correctNewRange) => {
      it(`testCharacterRangeFollow#${testId}`, async function () {
        cs = Changeset.checkRep(cs);
        expect(Changeset.characterRangeFollow(cs, oldRange[0], oldRange[1], insertionsAfter))
            .to.eql(correctNewRange);
      });
    };

    testCharacterRangeFollow(1, 'Z:z>9*0=1=4-3+9=1|1-4-4+1*0+a$123456789abcdefghijk',
        [7, 10], false, [14, 15]);
    testCharacterRangeFollow(2, 'Z:bc<6|x=b4|2-6$', [400, 407], false, [400, 401]);
    testCharacterRangeFollow(3, 'Z:4>0-3+3$abc', [0, 3], false, [3, 3]);
    testCharacterRangeFollow(4, 'Z:4>0-3+3$abc', [0, 3], true, [0, 0]);
    testCharacterRangeFollow(5, 'Z:5>1+1=1-3+3$abcd', [1, 4], false, [5, 5]);
    testCharacterRangeFollow(6, 'Z:5>1+1=1-3+3$abcd', [1, 4], true, [2, 2]);
    testCharacterRangeFollow(7, 'Z:5>1+1=1-3+3$abcd', [0, 6], false, [1, 7]);
    testCharacterRangeFollow(8, 'Z:5>1+1=1-3+3$abcd', [0, 3], false, [1, 2]);
    testCharacterRangeFollow(9, 'Z:5>1+1=1-3+3$abcd', [2, 5], false, [5, 6]);
    testCharacterRangeFollow(10, 'Z:2>1+1$a', [0, 0], false, [1, 1]);
    testCharacterRangeFollow(11, 'Z:2>1+1$a', [0, 0], true, [0, 0]);
  });
});
