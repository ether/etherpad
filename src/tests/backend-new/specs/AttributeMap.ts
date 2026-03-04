'use strict';

import AttributeMap from '../../../static/js/AttributeMap';
import AttributePool from '../../../static/js/AttributePool';
import attributes from '../../../static/js/attributes';
import {expect, describe, it, beforeEach} from 'vitest'
import {Attribute} from "../../../static/js/types/Attribute";

describe('AttributeMap', function () {
  const attribs: Attribute[] = [
    ['foo', 'bar'],
    ['baz', 'bif'],
    ['emptyValue', ''],
  ];
  let pool: AttributePool;

  const getPoolSize = () => {
    let n = 0;
    pool.eachAttrib(() => ++n);
    return n;
  };

  beforeEach(async function () {
    pool = new AttributePool();
    for (let i = 0; i < attribs.length; ++i) expect(pool.putAttrib(attribs[i])).to.equal(i);
  });

  it('fromString works', async function () {
    const got = AttributeMap.fromString('*0*1*2', pool);
    for (const [k, v] of attribs) expect(got.get(k)).to.equal(v);
    // Maps iterate in insertion order, so [...got] should be in the same order as attribs.
    expect(JSON.stringify([...got])).to.equal(JSON.stringify(attribs));
  });

  describe('set', function () {
    it('stores the value', async function () {
      const m = new AttributeMap(pool);
      expect(m.size).to.equal(0);
      m.set('k', 'v');
      expect(m.size).to.equal(1);
      expect(m.get('k')).to.equal('v');
    });

    it('reuses attributes in the pool', async function () {
      expect(getPoolSize()).to.equal(attribs.length);
      const m = new AttributeMap(pool);
      const [k0, v0] = attribs[0];
      m.set(k0, v0);
      expect(getPoolSize()).to.equal(attribs.length);
      expect(m.size).to.equal(1);
      expect(m.toString()).to.equal('*0');
    });

    it('inserts new attributes into the pool', async function () {
      const m = new AttributeMap(pool);
      expect(getPoolSize()).to.equal(attribs.length);
      m.set('k', 'v');
      expect(getPoolSize()).to.equal(attribs.length + 1);
      expect(JSON.stringify(pool.getAttrib(attribs.length))).to.equal(JSON.stringify(['k', 'v']));
    });

    describe('coerces key and value to string', function () {
      const testCases = [
        ['object (with toString)', {toString: () => 'obj'}, 'obj'],
        ['undefined', undefined, ''],
        ['null', null, ''],
        ['boolean', true, 'true'],
        ['number', 1, '1'],
      ];
      for (const [desc, input, want] of testCases) {
        describe(desc as string, function () {
          it('key is coerced to string', async function () {
            const m = new AttributeMap(pool);
            // @ts-ignore
            m.set(input, 'value');
            expect(m.get(want)).to.equal('value');
          });

          it('value is coerced to string', async function () {
            const m = new AttributeMap(pool);
            // @ts-ignore
            m.set('key', input);
            expect(m.get('key')).to.equal(want);
          });
        });
      }
    });

    it('returns the map', async function () {
      const m = new AttributeMap(pool);
      expect(m.set('k', 'v')).to.equal(m);
    });
  });

  describe('toString', function () {
    it('sorts attributes', async function () {
      const m = new AttributeMap(pool).update(attribs);
      const got = [...attributes.attribsFromString(m.toString(), pool)];
      const want = attributes.sort([...attribs]);
      // Verify that attribs is not already sorted so that this test doesn't accidentally pass.
      expect(JSON.stringify(want)).to.not.equal(JSON.stringify(attribs));
      expect(JSON.stringify(got)).to.equal(JSON.stringify(want));
    });

    it('returns all entries', async function () {
      const m = new AttributeMap(pool);
      expect(m.toString()).to.equal('');
      m.set(...attribs[0]);
      expect(m.toString()).to.equal('*0');
      m.delete(attribs[0][0]);
      expect(m.toString()).to.equal('');
      m.set(...attribs[1]);
      expect(m.toString()).to.equal('*1');
      m.set(attribs[1][0], 'new value');
      expect(m.toString()).to.equal(attributes.encodeAttribString([attribs.length]));
      m.set(...attribs[2]);
      expect(m.toString()).to.equal(attributes.attribsToString(
          attributes.sort([attribs[2], [attribs[1][0], 'new value']]), pool));
    });
  });

  for (const funcName of ['update', 'updateFromString']) {
    const callUpdateFn = (m: any, ...args: (boolean | (string | null | undefined)[][])[]) => {
      if (funcName === 'updateFromString') {
        // @ts-ignore
        args[0] = attributes.attribsToString(attributes.sort([...args[0]]), pool);
      }
      // @ts-ignore
      return AttributeMap.prototype[funcName].call(m, ...args);
    };

    describe(funcName, function () {
      it('works', async function () {
        const m = new AttributeMap(pool);
        m.set(attribs[2][0], 'value to be overwritten');
        callUpdateFn(m, attribs);
        for (const [k, v] of attribs) expect(m.get(k)).to.equal(v);
        expect(m.size).to.equal(attribs.length);
        const wantStr = attributes.attribsToString(attributes.sort([...attribs]), pool);
        expect(m.toString()).to.equal(wantStr);
        callUpdateFn(m, []);
        expect(m.toString()).to.equal(wantStr);
      });

      it('inserts new attributes into the pool', async function () {
        const m = new AttributeMap(pool);
        callUpdateFn(m, [['k', 'v']]);
        expect(m.size).to.equal(1);
        expect(m.get('k')).to.equal('v');
        expect(getPoolSize()).to.equal(attribs.length + 1);
        expect(m.toString()).to.equal(attributes.encodeAttribString([attribs.length]));
      });

      it('returns the map', async function () {
        const m = new AttributeMap(pool);
        expect(callUpdateFn(m, [])).to.equal(m);
      });

      describe('emptyValueIsDelete=false inserts empty values', function () {
        for (const emptyVal of ['', null, undefined]) {
          it(emptyVal == null ? String(emptyVal) : JSON.stringify(emptyVal), async function () {
            const m = new AttributeMap(pool);
            m.set('k', 'v');
            callUpdateFn(m, [['k', emptyVal]]);
            expect(m.size).to.equal(1);
            expect(m.toString()).to.equal(attributes.attribsToString([['k', '']], pool));
          });
        }
      });

      describe('emptyValueIsDelete=true deletes entries', function () {
        for (const emptyVal of ['', null, undefined]) {
          it(emptyVal == null ? String(emptyVal) : JSON.stringify(emptyVal), async function () {
            const m = new AttributeMap(pool);
            m.set('k', 'v');
            callUpdateFn(m, [['k', emptyVal]], true);
            expect(m.size).to.equal(0);
            expect(m.toString()).to.equal('');
          });
        }
      });
    });
  }
});
