/**
 * @returns {StringAssembler}
 */
export class StringAssembler {
  private str = ''
  clear = ()=> {
    this.str = '';
  }
  /**
   * @param {string} x -
   */
  append(x: string) {
    this.str += String(x);
  }
  toString() {
    return this.str
  }
}
