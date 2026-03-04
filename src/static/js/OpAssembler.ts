import Op from "./Op";
import {assert} from './Changeset'

/**
 * @returns {OpAssembler}
 */
export class OpAssembler {
  private serialized: string;
  constructor() {
    this.serialized = ''

  }
  append = (op: Op) => {
    assert(op instanceof Op, 'argument must be an instance of Op');
    this.serialized += op.toString();
  }
  toString = () => this.serialized
  clear = () => {
    this.serialized = '';
  }
}
