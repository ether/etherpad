import {assert} from "./Changeset";

/**
 * A custom made String Iterator
 *
 * @typedef {object} StringIterator
 * @property {Function} newlines -
 * @property {Function} peek -
 * @property {Function} remaining -
 * @property {Function} skip -
 * @property {Function} take -
 */

/**
 * @param {string} str - String to iterate over
 * @returns {StringIterator}
 */
export class StringIterator {
  private curIndex: number;
  private newLines: number;
  private str: String

  constructor(str: string) {
    this.curIndex = 0;
    this.str = str
    this.newLines = str.split('\n').length - 1;
  }
  remaining = () => this.str.length - this.curIndex;

  getnewLines = () => this.newLines;

  assertRemaining = (n: number) => {
    assert(n <= this.remaining(), `!(${n} <= ${this.remaining()})`);
  }

  take = (n: number) => {
    this.assertRemaining(n);
    const s = this.str.substring(this.curIndex, this.curIndex+n);
    this.newLines -= s.split('\n').length - 1;
    this.curIndex += n;
    return s;
  }

  peek = (n: number) => {
    this.assertRemaining(n);
    return this.str.substring(this.curIndex, this.curIndex+n);
  }

  skip = (n: number) => {
    this.assertRemaining(n);
    this.curIndex += n;
  }

}
