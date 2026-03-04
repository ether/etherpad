import {OpAssembler} from "./OpAssembler";
import Op from "./Op";
import {clearOp, copyOp} from "./Changeset";

export class MergingOpAssembler {
  private assem: OpAssembler;
  private readonly bufOp: Op;
  private bufOpAdditionalCharsAfterNewline: number;

  constructor() {
    this.assem = new OpAssembler()
    this.bufOp = new Op()
    // If we get, for example, insertions [xxx\n,yyy], those don't merge,
    // but if we get [xxx\n,yyy,zzz\n], that merges to [xxx\nyyyzzz\n].
    // This variable stores the length of yyy and any other newline-less
    // ops immediately after it.
    this.bufOpAdditionalCharsAfterNewline = 0;
  }

  /**
   * @param {boolean} [isEndDocument]
   */
  flush = (isEndDocument?: boolean) => {
    if (!this.bufOp.opcode) return;
    if (isEndDocument && this.bufOp.opcode === '=' && !this.bufOp.attribs) {
      // final merged keep, leave it implicit
    } else {
      this.assem.append(this.bufOp);
      if (this.bufOpAdditionalCharsAfterNewline) {
        this.bufOp.chars = this.bufOpAdditionalCharsAfterNewline;
        this.bufOp.lines = 0;
        this.assem.append(this.bufOp);
        this.bufOpAdditionalCharsAfterNewline = 0;
      }
    }
    this.bufOp.opcode = '';
  }

  append = (op: Op) => {
    if (op.chars <= 0) return;
    if (this.bufOp.opcode === op.opcode && this.bufOp.attribs === op.attribs) {
      if (op.lines > 0) {
        // bufOp and additional chars are all mergeable into a multi-line op
        this.bufOp.chars += this.bufOpAdditionalCharsAfterNewline + op.chars;
        this.bufOp.lines += op.lines;
        this.bufOpAdditionalCharsAfterNewline = 0;
      } else if (this.bufOp.lines === 0) {
        // both bufOp and op are in-line
        this.bufOp.chars += op.chars;
      } else {
        // append in-line text to multi-line bufOp
        this.bufOpAdditionalCharsAfterNewline += op.chars;
      }
    } else {
      this.flush();
      copyOp(op, this.bufOp);
    }
  }

  endDocument = () => {
    this.flush(true);
  };

  toString = () => {
    this.flush();
    return this.assem.toString();
  };

  clear = () => {
    this.assem.clear();
    clearOp(this.bufOp);
  };
}
