/**
 * Incrementally builds a Changeset.
 *
 * @typedef {object} Builder
 * @property {Function} insert -
 * @property {Function} keep -
 * @property {Function} keepText -
 * @property {Function} remove -
 * @property {Function} toString -
 */
import {SmartOpAssembler} from "./SmartOpAssembler";
import Op from "./Op";
import {StringAssembler} from "./StringAssembler";
import AttributeMap from "./AttributeMap";
import {Attribute} from "./types/Attribute";
import AttributePool from "./AttributePool";
import {opsFromText, pack} from "./Changeset";

/**
 * @param {number} oldLen - Old length
 * @returns {Builder}
 */
export class Builder {
  private readonly oldLen: number;
  private assem: SmartOpAssembler;
  private readonly o: Op;
  private charBank: StringAssembler;

  constructor(oldLen: number) {
    this.oldLen = oldLen
    this.assem = new SmartOpAssembler()
    this.o = new Op()
    this.charBank = new StringAssembler()
  }

  /**
   * @param {number} N - Number of characters to keep.
   * @param {number} L - Number of newlines among the `N` characters. If positive, the last
   *     character must be a newline.
   * @param {(string|Attribute[])} attribs - Either [[key1,value1],[key2,value2],...] or '*0*1...'
   *     (no pool needed in latter case).
   * @param {?AttributePool.ts} pool - Attribute pool, only required if `attribs` is a list of
   *     attribute key, value pairs.
   * @returns {Builder} this
   */
  keep =  (N: number, L?: number, attribs?: string|Attribute[], pool?: AttributePool): Builder => {
    this.o.opcode = '=';
    this.o.attribs = typeof attribs === 'string'
      ? attribs : new AttributeMap(pool).update(attribs || []).toString();
    this.o.chars = N;
    this.o.lines = (L || 0);
    this.assem.append(this.o);
    return this;
  }


  /**
   * @param {string} text - Text to keep.
   * @param {(string|Attribute[])} attribs - Either [[key1,value1],[key2,value2],...] or '*0*1...'
   *     (no pool needed in latter case).
   * @param {?AttributePool.ts} pool - Attribute pool, only required if `attribs` is a list of
   *     attribute key, value pairs.
   * @returns {Builder} this
   */
  keepText= (text: string, attribs?: string|Attribute[], pool?: AttributePool): Builder=> {
    for (const op of opsFromText('=', text, attribs, pool)) this.assem.append(op);
    return this;
  }


  /**
   * @param {string} text - Text to insert.
   * @param {(string|Attribute[])} attribs - Either [[key1,value1],[key2,value2],...] or '*0*1...'
   *     (no pool needed in latter case).
   * @param {?AttributePool.ts} pool - Attribute pool, only required if `attribs` is a list of
   *     attribute key, value pairs.
   * @returns {Builder} this
   */
  insert= (text: string, attribs: string | Attribute[] | undefined, pool?: AttributePool | null | undefined): Builder => {
    for (const op of opsFromText('+', text, attribs, pool)) this.assem.append(op);
    this.charBank.append(text);
    return this;
  }


  /**
   * @param {number} N - Number of characters to remove.
   * @param {number} L - Number of newlines among the `N` characters. If positive, the last
   *     character must be a newline.
   * @returns {Builder} this
   */
  remove= (N: number, L?: number): Builder => {
    this.o.opcode = '-';
    this.o.attribs = '';
    this.o.chars = N;
    this.o.lines = (L || 0);
    this.assem.append(this.o);
    return this;
  }

  toString= () => {
    this.assem.endDocument();
    const newLen = this.oldLen + this.assem.getLengthChange();
    return pack(this.oldLen, newLen, this.assem.toString(), this.charBank.toString());
  }
}


