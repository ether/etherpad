import {expect, describe, it} from 'vitest'
import {StringIterator} from "../../../static/js/StringIterator";


describe('Test string iterator take', function () {
  it('should iterate over a string', async function () {
    const str = 'Hello, world!';
    const iter = new StringIterator(str);
    let i = 0;
    while (iter.remaining() > 0) {
      expect(iter.remaining()).to.equal(str.length - i);
      console.error(iter.remaining());
      expect(iter.take(1)).to.equal(str.charAt(i));
      i++;
    }
  });
})


describe('Test string iterator peek', function () {
  it('should peek over a string', async function () {
    const str = 'Hello, world!';
    const iter = new StringIterator(str);
    let i = 0;
    while (iter.remaining() > 0) {
      expect(iter.remaining()).to.equal(str.length - i);
      expect(iter.peek(1)).to.equal(str.charAt(i));
      i++;
      iter.skip(1);
    }
  });
})

describe('Test string iterator skip', function () {
  it('should throw error when skip over a string too long', async function () {
    const str = 'Hello, world!';
    const iter = new StringIterator(str);
    expect(()=>iter.skip(1000)).toThrowError();
  });

  it('should skip over a string', async function () {
    const str = 'Hello, world!';
    const iter = new StringIterator(str);
    iter.skip(7);
    expect(iter.take(1)).to.equal('w');
  });
})
