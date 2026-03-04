import Op from "./Op";
import {clearOp, copyOp, deserializeOps} from "./Changeset";

/**
 * Iterator over a changeset's operations.
 *
 * Note: This class does NOT implement the ECMAScript iterable or iterator protocols.
 *
 * @deprecated Use `deserializeOps` instead.
 */
export class OpIter {
  private gen
  private _next: IteratorResult<Op, void>
  /**
   * @param {string} ops - String encoding the change operations to iterate over.
   */
  constructor(ops: string) {
    this.gen = deserializeOps(ops);
    this._next = this.gen.next();
  }

  /**
   * @returns {boolean} Whether there are any remaining operations.
   */
  hasNext(): boolean {
    return !this._next.done;
  }

  /**
   * Returns the next operation object and advances the iterator.
   *
   * Note: This does NOT implement the ECMAScript iterator protocol.
   *
   * @param {Op} [opOut] - Deprecated. Operation object to recycle for the return value.
   * @returns {Op} The next operation, or an operation with a falsy `opcode` property if there are
   *     no more operations.
   */
  next(opOut: Op = new Op()): Op {
    if (this.hasNext()) {
      copyOp(this._next.value!, opOut);
      this._next = this.gen.next();
    } else {
      clearOp(opOut);
    }
    return opOut;
  }
}
