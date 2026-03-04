import {numToString} from "./ChangesetUtils";

export type OpCode = ''|'='|'+'|'-';


/**
 * An operation to apply to a shared document.
 */
export default class Op {
  opcode: ''|'='|'+'|'-'
  chars: number
  lines: number
  attribs: string
  /**
   * @param {(''|'='|'+'|'-')} [opcode=''] - Initial value of the `opcode` property.
   */
  constructor(opcode:''|'='|'+'|'-' = '') {
    /**
     * The operation's operator:
     *   - '=': Keep the next `chars` characters (containing `lines` newlines) from the base
     *     document.
     *   - '-': Remove the next `chars` characters (containing `lines` newlines) from the base
     *     document.
     *   - '+': Insert `chars` characters (containing `lines` newlines) at the current position in
     *     the document. The inserted characters come from the changeset's character bank.
     *   - '' (empty string): Invalid operator used in some contexts to signifiy the lack of an
     *     operation.
     *
     * @type {(''|'='|'+'|'-')}
     * @public
     */
    this.opcode = opcode;

    /**
     * The number of characters to keep, insert, or delete.
     *
     * @type {number}
     * @public
     */
    this.chars = 0;

    /**
     * The number of characters among the `chars` characters that are newlines. If non-zero, the
     * last character must be a newline.
     *
     * @type {number}
     * @public
     */
    this.lines = 0;

    /**
     * Identifiers of attributes to apply to the text, represented as a repeated (zero or more)
     * sequence of asterisk followed by a non-negative base-36 (lower-case) integer. For example,
     * '*2*1o' indicates that attributes 2 and 60 apply to the text affected by the operation. The
     * identifiers come from the document's attribute pool.
     *
     * For keep ('=') operations, the attributes are merged with the base text's existing
     * attributes:
     *   - A keep op attribute with a non-empty value replaces an existing base text attribute that
     *     has the same key.
     *   - A keep op attribute with an empty value is interpreted as an instruction to remove an
     *     existing base text attribute that has the same key, if one exists.
     *
     * This is the empty string for remove ('-') operations.
     *
     * @type {string}
     * @public
     */
    this.attribs = '';
  }

  toString() {
    if (!this.opcode) throw new TypeError('null op');
    if (typeof this.attribs !== 'string') throw new TypeError('attribs must be a string');
    const l = this.lines ? `|${numToString(this.lines)}` : '';
    return this.attribs + l + this.opcode + numToString(this.chars);
  }
}
