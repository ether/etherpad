import {MergingOpAssembler} from "./MergingOpAssembler";
import {StringAssembler} from "./StringAssembler";
import padutils from "./pad_utils";
import Op from "./Op";
import { Attribute } from "./types/Attribute";
import AttributePool from "./AttributePool";
import {opsFromText} from "./Changeset";

/**
 * Creates an object that allows you to append operations (type Op) and also compresses them if
 * possible. Like MergingOpAssembler, but able to produce conforming exportss from slightly looser
 * input, at the cost of speed. Specifically:
 *   - merges consecutive operations that can be merged
 *   - strips final "="
 *   - ignores 0-length changes
 *   - reorders consecutive + and - (which MergingOpAssembler doesn't do)
 *
 * @typedef {object} SmartOpAssembler
 * @property {Function} append -
 * @property {Function} appendOpWithText -
 * @property {Function} clear -
 * @property {Function} endDocument -
 * @property {Function} getLengthChange -
 * @property {Function} toString -
 */
export class SmartOpAssembler {
  private minusAssem: MergingOpAssembler;
  private plusAssem: MergingOpAssembler;
  private keepAssem: MergingOpAssembler;
  private lastOpcode: string;
  private lengthChange: number;
  private assem: StringAssembler;

  constructor() {
    this.minusAssem = new MergingOpAssembler()
    this.plusAssem = new MergingOpAssembler()
    this.keepAssem = new MergingOpAssembler()
    this.assem = new StringAssembler()
    this.lastOpcode = ''
    this.lengthChange = 0
  }

  flushKeeps = () => {
    this.assem.append(this.keepAssem.toString());
    this.keepAssem.clear();
  };

  flushPlusMinus = () => {
    this.assem.append(this.minusAssem.toString());
    this.minusAssem.clear();
    this.assem.append(this.plusAssem.toString());
    this.plusAssem.clear();
  };

  append = (op: Op) => {
    if (!op.opcode) return;
    if (!op.chars) return;

    if (op.opcode === '-') {
      if (this.lastOpcode === '=') {
        this.flushKeeps();
      }
      this.minusAssem.append(op);
      this.lengthChange -= op.chars;
    } else if (op.opcode === '+') {
      if (this.lastOpcode === '=') {
        this.flushKeeps();
      }
      this.plusAssem.append(op);
      this.lengthChange += op.chars;
    } else if (op.opcode === '=') {
      if (this.lastOpcode !== '=') {
        this.flushPlusMinus();
      }
      this.keepAssem.append(op);
    }
    this.lastOpcode = op.opcode;
  };

  /**
   * Generates operations from the given text and attributes.
   *
   * @deprecated Use `opsFromText` instead.
   * @param {('-'|'+'|'=')} opcode - The operator to use.
   * @param {string} text - The text to remove/add/keep.
   * @param {(string|Iterable<Attribute>)} attribs - The attributes to apply to the operations.
   * @param {?AttributePool.ts} pool - Attribute pool. Only required if `attribs` is an iterable of
   *     attribute key, value pairs.
   */
  appendOpWithText = (opcode: '-'|'+'|'=', text: string, attribs: Attribute[]|string, pool?: AttributePool) => {
    padutils.warnDeprecated('Changeset.smartOpAssembler().appendOpWithText() is deprecated; ' +
      'use opsFromText() instead.');
    for (const op of opsFromText(opcode, text, attribs, pool)) this.append(op);
  };

  toString = () => {
    this.flushPlusMinus();
    this.flushKeeps();
    return this.assem.toString();
  };

  clear = () => {
    this.minusAssem.clear();
    this.plusAssem.clear();
    this.keepAssem.clear();
    this.assem.clear();
    this.lengthChange = 0;
  };

  endDocument = () => {
    this.keepAssem.endDocument();
  };

  getLengthChange = () => this.lengthChange;
}
