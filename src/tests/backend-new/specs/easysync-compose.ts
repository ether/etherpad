'use strict';

import {applyToText, checkRep, compose} from '../../../static/js/Changeset';
import AttributePool from '../../../static/js/AttributePool';
import {randomMultiline, randomTestChangeset} from '../easysync-helper';
import {expect, describe, it} from 'vitest';

describe('easysync-compose', function () {
  describe('compose', function () {
    const testCompose = (randomSeed: number) => {
      it(`testCompose#${randomSeed}`, async function () {
        const p = new AttributePool();

        const startText = `${randomMultiline(10, 20)}\n`;

        const x1 = randomTestChangeset(startText);
        const change1 = x1[0];
        const text1 = x1[1];

        const x2 = randomTestChangeset(text1);
        const change2 = x2[0];
        const text2 = x2[1];

        const x3 = randomTestChangeset(text2);
        const change3 = x3[0];
        const text3 = x3[1];

        const change12 = checkRep(compose(change1, change2, p));
        const change23 = checkRep(compose(change2, change3, p));
        const change123 = checkRep(compose(change12, change3, p));
        const change123a = checkRep(compose(change1, change23, p));
        expect(change123a).to.equal(change123);

        expect(applyToText(change12, startText)).to.equal(text2);
        expect(applyToText(change23, text1)).to.equal(text3);
        expect(applyToText(change123, startText)).to.equal(text3);
      });
    };

    for (let i = 0; i < 30; i++) testCompose(i);
  });

  describe('compose attributes', function () {
    it('simpleComposeAttributesTest', async function () {
      const p = new AttributePool();
      p.putAttrib(['bold', '']);
      p.putAttrib(['bold', 'true']);
      const cs1 = checkRep('Z:2>1*1+1*1=1$x');
      const cs2 = checkRep('Z:3>0*0|1=3$');
      const cs12 = checkRep(compose(cs1, cs2, p));
      expect(cs12).to.equal('Z:2>1+1*0|1=2$x');
    });
  });
});
