'use strict';

/*
 * Copyright 2009 Google Inc., 2011 Peter 'Pita' Martischka (Primary Technology Ltd)
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS-IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/*
 * This is the Changeset library copied from the old Etherpad with some modifications
 * to use it in node.js. The original can be found at:
 * https://github.com/ether/pad/blob/master/infrastructure/ace/www/easysync2.js
 */

import AttributeMap from './AttributeMap'
import AttributePool from "./AttributePool";
import {attribsFromString} from './attributes';
import padutils from "./pad_utils";
import Op, {OpCode} from './Op'
import {numToString, parseNum} from './ChangesetUtils'
import {StringAssembler} from "./StringAssembler";
import {OpIter} from "./OpIter";
import {Attribute} from "./types/Attribute";
import {SmartOpAssembler} from "./SmartOpAssembler";
import TextLinesMutator from "./TextLinesMutator";
import {ChangeSet} from "./types/ChangeSet";
import {AText} from "./types/AText";
import {ChangeSetBuilder} from "./types/ChangeSetBuilder";
import {Builder} from "./Builder";
import {StringIterator} from "./StringIterator";
import {MergingOpAssembler} from "./MergingOpAssembler";

/**
 * A `[key, value]` pair of strings describing a text attribute.
 *
 * @typedef {[string, string]} Attribute
 */

/**
 * A concatenated sequence of zero or more attribute identifiers, each one represented by an
 * asterisk followed by a base-36 encoded attribute number.
 *
 * Examples: '', '*0', '*3*j*z*1q'
 *
 * @typedef {string} AttributeString
 */

/**
 * This method is called whenever there is an error in the sync process.
 *
 * @param {string} msg - Just some message
 */
const error = (msg: string) => {
  const e = new Error(msg);
  // @ts-ignore
  e.easysync = true;
  throw e;
};

/**
 * Assert that a condition is truthy. If the condition is falsy, the `error` function is called to
 * throw an exception.
 *
 * @param {boolean} b - assertion condition
 * @param {string} msg - error message to include in the exception
 * @type {(b: boolean, msg: string) => asserts b}
 */
export const assert: (b: boolean, msg: string) => asserts b = (b: boolean, msg: string): asserts b => {
  if (!b) error(`Failed assertion: ${msg}`);
};


/**
 * Describes changes to apply to a document. Does not include the attribute pool or the original
 * document.
 *
 * @typedef {object} Changeset
 * @property {number} oldLen - The length of the base document.
 * @property {number} newLen - The length of the document after applying the changeset.
 * @property {string} ops - Serialized sequence of operations. Use `deserializeOps` to parse this
 *     string.
 * @property {string} charBank - Characters inserted by insert operations.
 */

/**
 * Returns the required length of the text before changeset can be applied.
 *
 * @param {string} cs - String representation of the Changeset
 * @returns {number} oldLen property
 */
export const oldLen = (cs: string) => unpack(cs).oldLen

/**
 * Returns the length of the text after changeset is applied.
 *
 * @param {string} cs - String representation of the Changeset
 * @returns {number} newLen property
 */
export const newLen = (cs: string) => unpack(cs).newLen

/**
 * Parses a string of serialized changeset operations.
 *
 * @param {string} ops - Serialized changeset operations.
 * @yields {Op}
 * @returns {Generator<Op>}
 */
export const deserializeOps = function* (ops: string) {
  // TODO: Migrate to String.prototype.matchAll() once there is enough browser support.
  const regex = /((?:\*[0-9a-z]+)*)(?:\|([0-9a-z]+))?([-+=])([0-9a-z]+)|(.)/g;
  let match;
  while ((match = regex.exec(ops)) != null) {
    if (match[5] === '$') return; // Start of the insert operation character bank.
    if (match[5] != null) error(`invalid operation: ${ops.slice(regex.lastIndex - 1)}`);
    const opMatch = match[3] as   ""|"=" | "+" | "-" | undefined
    const op = new Op(opMatch);
    op.lines = parseNum(match[2] || '0');
    op.chars = parseNum(match[4]);
    op.attribs = match[1];
    yield op;
  }
};



/**
 * Creates an iterator which decodes string changeset operations.
 *
 * @deprecated Use `deserializeOps` instead.
 * @param {string} opsStr - String encoding of the change operations to perform.
 * @returns {OpIter} Operator iterator object.
 */
export const opIterator = (opsStr: string) => {
  padutils.warnDeprecated(
    'Changeset.opIterator() is deprecated; use Changeset.deserializeOps() instead');
  return new OpIter(opsStr);
};

/**
 * Cleans an Op object.
 *
 * @param {Op} op - object to clear
 */
export const clearOp = (op: Op) => {
  op.opcode = '';
  op.chars = 0;
  op.lines = 0;
  op.attribs = '';
};

/**
 * Creates a new Op object
 *
 * @deprecated Use the `Op` class instead.
 * @param {('+'|'-'|'='|'')} [optOpcode=''] - The operation's operator.
 * @returns {Op}
 */
export const newOp = (optOpcode:'+'|'-'|'='|'' ): Op => {
  padutils.warnDeprecated('Changeset.newOp() is deprecated; use the Changeset.Op class instead');
  return new Op(optOpcode);
};

/**
 * Copies op1 to op2
 *
 * @param {Op} op1 - src Op
 * @param {Op} [op2] - dest Op. If not given, a new Op is used.
 * @returns {Op} `op2`
 */
export const copyOp = (op1: Op, op2: Op = new Op()): Op => Object.assign(op2, op1);

/**
 * Serializes a sequence of Ops.
 *
 * @typedef {object} OpAssembler
 * @property {Function} append -
 * @property {Function} clear -
 * @property {Function} toString -
 */

/**
 * Efficiently merges consecutive operations that are mergeable, ignores no-ops, and drops final
 * pure "keeps". It does not re-order operations.
 *
 * @typedef {object} MergingOpAssembler
 * @property {Function} append -
 * @property {Function} clear -
 * @property {Function} endDocument -
 * @property {Function} toString -
 */

/**
 * Generates operations from the given text and attributes.
 *
 * @param {('-'|'+'|'=')} opcode - The operator to use.
 * @param {string} text - The text to remove/add/keep.
 * @param {(Iterable<Attribute>|AttributeString)} [attribs] - The attributes to insert into the pool
 *     (if necessary) and encode. If an attribute string, no checking is performed to ensure that
 *     the attributes exist in the pool, are in the canonical order, and contain no duplicate keys.
 *     If this is an iterable of attributes, `pool` must be non-null.
 * @param {?AttributePool.ts} pool - Attribute pool. Required if `attribs` is an iterable of
 *     attributes, ignored if `attribs` is an attribute string.
 * @yields {Op} One or two ops (depending on the presense of newlines) that cover the given text.
 * @returns {Generator<Op>}
 */
export const opsFromText = function* (opcode: "" | "=" | "+" | "-" | undefined, text: string, attribs: string|Attribute[] = '', pool: AttributePool|null = null) {
  const op = new Op(opcode);
  op.attribs = typeof attribs === 'string'
    ? attribs : new AttributeMap(pool).update(attribs || [], opcode === '+').toString();
  const lastNewlinePos = text.lastIndexOf('\n');
  if (lastNewlinePos < 0) {
    op.chars = text.length;
    op.lines = 0;
    yield op;
  } else {
    op.chars = lastNewlinePos + 1;
    op.lines = text.match(/\n/g)!.length;
    yield op;
    const op2 = copyOp(op);
    op2.chars = text.length - (lastNewlinePos + 1);
    op2.lines = 0;
    yield op2;
  }
};



/**
 * Used to check if a Changeset is valid. This function does not check things that require access to
 * the attribute pool (e.g., attribute order) or original text (e.g., newline positions).
 *
 * @param {string} cs - Changeset to check
 * @returns {string} the checked Changeset
 */
export const checkRep = (cs: string) => {
  const unpacked = unpack(cs);
  const oldLen = unpacked.oldLen;
  const newLen = unpacked.newLen;
  const ops = unpacked.ops;
  let charBank = unpacked.charBank;

  const assem = new SmartOpAssembler();
  let oldPos = 0;
  let calcNewLen = 0;
  for (const o of deserializeOps(ops)) {
    switch (o.opcode) {
      case '=':
        oldPos += o.chars;
        calcNewLen += o.chars;
        break;
      case '-':
        oldPos += o.chars;
        assert(oldPos <= oldLen, `${oldPos} > ${oldLen} in ${cs}`);
        break;
      case '+':
      {
        assert(charBank.length >= o.chars, 'Invalid changeset: not enough chars in charBank');
        const chars = charBank.slice(0, o.chars);
        const nlines = (chars.match(/\n/g) || []).length;
        assert(nlines === o.lines,
          'Invalid changeset: number of newlines in insert op does not match the charBank');
        assert(o.lines === 0 || chars.endsWith('\n'),
          'Invalid changeset: multiline insert op does not end with a newline');
        charBank = charBank.slice(o.chars);
        calcNewLen += o.chars;
        assert(calcNewLen <= newLen, `${calcNewLen} > ${newLen} in ${cs}`);
        break;
      }
      default:
        assert(false, `Invalid changeset: Unknown opcode: ${JSON.stringify(o.opcode)}`);
    }
    assem.append(o);
  }
  calcNewLen += oldLen - oldPos;
  assert(calcNewLen === newLen, 'Invalid changeset: claimed length does not match actual length');
  assert(charBank === '', 'Invalid changeset: excess characters in the charBank');
  assem.endDocument();
  const normalized = pack(oldLen, calcNewLen, assem.toString(), unpacked.charBank);
  assert(normalized === cs, 'Invalid changeset: not in canonical form');
  return cs;
};

/**
 * A custom made StringBuffer
 *
 * @typedef {object} StringAssembler
 * @property {Function} append -
 * @property {Function} toString -
 */

/**
 * @typedef {object} StringArrayLike
 * @property {(i: number) => string} get - Returns the line at index `i`.
 * @property {(number|(() => number))} length - The number of lines, or a method that returns the
 *     number of lines.
 * @property {(((start?: number, end?: number) => string[])|undefined)} slice - Like
 *     `Array.prototype.slice()`. Optional if the return value of the `removeLines` method is not
 *     needed.
 * @property {(i: number, d?: number, ...l: string[]) => any} splice - Like
 *     `Array.prototype.splice()`.
 */


/**
 * Apply operations to other operations.
 *
 * @param {string} in1 - first Op string
 * @param {string} in2 - second Op string
 * @param {Function} func - Callback that applies an operation to another operation. Will be called
 *     multiple times depending on the number of operations in `in1` and `in2`. `func` has signature
 *     `opOut = f(op1, op2)`:
 *       - `op1` is the current operation from `in1`. `func` is expected to mutate `op1` to
 *         partially or fully consume it, and MUST set `op1.opcode` to the empty string once `op1`
 *         is fully consumed. If `op1` is not fully consumed, `func` will be called again with the
 *         same `op1` value. If `op1` is fully consumed, the next call to `func` will be given the
 *         next operation from `in1`. If there are no more operations in `in1`, `op1.opcode` will be
 *         the empty string.
 *       - `op2` is the current operation from `in2`, to apply to `op1`. Has the same consumption
 *         and advancement semantics as `op1`.
 *       - `opOut` is the result of applying `op2` (before consumption) to `op1` (before
 *         consumption). If there is no result (perhaps `op1` and `op2` canceled each other out),
 *         either `opOut` must be nullish or `opOut.opcode` must be the empty string.
 * @returns {string} the integrated changeset
 */
const applyZip = (in1: string, in2: string, func: Function): string => {
  const ops1 = deserializeOps(in1);
  const ops2 = deserializeOps(in2);
  let next1 = ops1.next();
  let next2 = ops2.next();
  const assem = new SmartOpAssembler();
  while (!next1.done || !next2.done) {
    if (!next1.done && !next1.value.opcode) next1 = ops1.next();
    if (!next2.done && !next2.value.opcode) next2 = ops2.next();
    if (next1.value == null) next1.value = new Op();
    if (next2.value == null) next2.value = new Op();
    if (!next1.value.opcode && !next2.value.opcode) break;
    const opOut = func(next1.value, next2.value);
    if (opOut && opOut.opcode) assem.append(opOut);
  }
  assem.endDocument();
  return assem.toString();
};

/**
 * Parses an encoded changeset.
 *
 * @param {string} cs - The encoded changeset.
 * @returns {Changeset}
 */
export const unpack = (cs: string): ChangeSet => {
  const headerRegex = /Z:([0-9a-z]+)([><])([0-9a-z]+)|/;
  const headerMatch = headerRegex.exec(cs);
  if ((!headerMatch) || (!headerMatch[0])) error(`Not a changeset: ${cs}`);
  const oldLen = parseNum(headerMatch![1]);
  const changeSign = (headerMatch![2] === '>') ? 1 : -1;
  const changeMag = parseNum(headerMatch![3]);
  const newLen = oldLen + changeSign * changeMag;
  const opsStart = headerMatch![0].length;
  let opsEnd = cs.indexOf('$');
  if (opsEnd < 0) opsEnd = cs.length;
  return {
    oldLen,
    newLen,
    ops: cs.substring(opsStart, opsEnd),
    charBank: cs.substring(opsEnd + 1),
  };
};

/**
 * Creates an encoded changeset.
 *
 * @param {number} oldLen - The length of the document before applying the changeset.
 * @param {number} newLen - The length of the document after applying the changeset.
 * @param {string} opsStr - Encoded operations to apply to the document.
 * @param {string} bank - Characters for insert operations.
 * @returns {string} The encoded changeset.
 */
export const pack = (oldLen: number, newLen: number, opsStr: string, bank: string): string => {
  const lenDiff = newLen - oldLen;
  const lenDiffStr = (lenDiff >= 0 ? `>${numToString(lenDiff)}`
    : `<${numToString(-lenDiff)}`);
  const a = [];
  a.push('Z:', numToString(oldLen), lenDiffStr, opsStr, '$', bank);
  return a.join('');
};

/**
 * Applies a Changeset to a string.
 *
 * @param {string} cs - String encoded Changeset
 * @param {string} str - String to which a Changeset should be applied
 * @returns {string}
 */
export const applyToText = (cs: string, str: string): string => {
  const unpacked = unpack(cs);
  assert(str.length === unpacked.oldLen, `mismatched apply: ${str.length} / ${unpacked.oldLen}`);
  const bankIter = new StringIterator(unpacked.charBank);
  const strIter = new StringIterator(str);
  const assem = new StringAssembler();
  for (const op of deserializeOps(unpacked.ops)) {
    switch (op.opcode) {
      case '+':
        // op is + and op.lines 0: no newlines must be in op.chars
        // op is + and op.lines >0: op.chars must include op.lines newlines
        if (op.lines !== bankIter.peek(op.chars).split('\n').length - 1) {
          throw new Error(`newline count is wrong in op +; cs:${cs} and text:${str}`);
        }
        assem.append(bankIter.take(op.chars));
        break;
      case '-':
        // op is - and op.lines 0: no newlines must be in the deleted string
        // op is - and op.lines >0: op.lines newlines must be in the deleted string
        if (op.lines !== strIter.peek(op.chars).split('\n').length - 1) {
          throw new Error(`newline count is wrong in op -; cs:${cs} and text:${str}`);
        }
        strIter.skip(op.chars);
        break;
      case '=':
        // op is = and op.lines 0: no newlines must be in the copied string
        // op is = and op.lines >0: op.lines newlines must be in the copied string
        if (op.lines !== strIter.peek(op.chars).split('\n').length - 1) {
          throw new Error(`newline count is wrong in op =; cs:${cs} and text:${str}`);
        }
        assem.append(strIter.take(op.chars));
        break;
    }
  }
  assem.append(strIter.take(strIter.remaining()));
  return assem.toString();
};

/**
 * Applies a changeset on an array of lines.
 *
 * @param {string} cs - the changeset to apply
 * @param {string[]} lines - The lines to which the changeset needs to be applied
 */
export const mutateTextLines = (cs: string, lines: RegExpMatchArray|string[] | null) => {
  const unpacked = unpack(cs);
  const bankIter = new StringIterator(unpacked.charBank);
  const mut = new TextLinesMutator(lines!);
  for (const op of deserializeOps(unpacked.ops)) {
    switch (op.opcode) {
      case '+':
        mut.insert(bankIter.take(op.chars), op.lines);
        break;
      case '-':
        mut.remove(op.chars, op.lines);
        break;
      case '=':
        mut.skip(op.chars, op.lines, (!!op.attribs));
        break;
    }
  }
  mut.close();
};

/**
 * Composes two attribute strings (see below) into one.
 *
 * @param {AttributeString} att1 - first attribute string
 * @param {AttributeString} att2 - second attribue string
 * @param {boolean} resultIsMutation -
 * @param {AttributePool.ts} pool - attribute pool
 * @returns {string}
 */
export const composeAttributes = (att1: string, att2: string, resultIsMutation: boolean, pool?: AttributePool|null): string => {
  // att1 and att2 are strings like "*3*f*1c", asMutation is a boolean.
  // Sometimes attribute (key,value) pairs are treated as attribute presence
  // information, while other times they are treated as operations that
  // mutate a set of attributes, and this affects whether an empty value
  // is a deletion or a change.
  // Examples, of the form (att1Items, att2Items, resultIsMutation) -> result
  // ([], [(bold, )], true) -> [(bold, )]
  // ([], [(bold, )], false) -> []
  // ([], [(bold, true)], true) -> [(bold, true)]
  // ([], [(bold, true)], false) -> [(bold, true)]
  // ([(bold, true)], [(bold, )], true) -> [(bold, )]
  // ([(bold, true)], [(bold, )], false) -> []
  // pool can be null if att2 has no attributes.
  if ((!att1) && resultIsMutation) {
    // In the case of a mutation (i.e. composing two exportss),
    // an att2 composed with an empy att1 is just att2.  If att1
    // is part of an attribution string, then att2 may remove
    // attributes that are already gone, so don't do this optimization.
    return att2;
  }
  if (!att2) return att1;
  return AttributeMap.fromString(att1, pool).updateFromString(att2, !resultIsMutation).toString();
};


/**
 * Applies a changeset to an array of attribute lines.
 *
 * @param {string} cs - The encoded changeset.
 * @param {Array<string>} lines - Attribute lines. Modified in place.
 * @param {AttributePool} pool - Attribute pool.
 */
export const mutateAttributionLines = (cs: any, lines: string[] | RegExpMatchArray, pool: AttributePool | null) => {
  const unpacked = unpack(cs);
  const csOps = deserializeOps(unpacked.ops);
  let csOpsNext = csOps.next();
  const csBank = unpacked.charBank;
  let csBankIndex = 0;
  // treat the attribution lines as text lines, mutating a line at a time
  const mut = new TextLinesMutator(lines);

  /**
   * The Ops in the current line from `lines`.
   *
   * @type {?Generator<Op>}
   */
  let lineOps: { next: () => any; } | null = null;
  let lineOpsNext: { done: any; value: any; } | null = null;

  const lineOpsHasNext = () => lineOpsNext && !lineOpsNext.done;
  /**
   * Returns false if we are on the last attribute line in `lines` and there is no additional op in
   * that line.
   *
   * @returns {boolean} True if there are more ops to go through.
   */
  const isNextMutOp = () => lineOpsHasNext() || mut.hasMore();

  /**
   * @returns {Op} The next Op from `lineIter`. If there are no more Ops, `lineIter` is reset to
   *     iterate over the next line, which is consumed from `mut`. If there are no more lines,
   *     returns a null Op.
   */
  const nextMutOp = () => {
    if (!lineOpsHasNext() && mut.hasMore()) {
      // There are more attribute lines in `lines` to do AND either we just started so `lineIter` is
      // still null or there are no more ops in current `lineIter`.
      const line = mut.removeLines(1);
      lineOps = deserializeOps(line);
      lineOpsNext = lineOps.next();
    }
    if (!lineOpsHasNext()) return new Op(); // No more ops and no more lines.
    const op = lineOpsNext!.value;
    lineOpsNext = lineOps!.next();
    return op;
  };
  let lineAssem: { append: (arg0: any) => void; toString: () => string; } | null = null;

  /**
   * Appends an op to `lineAssem`. In case `lineAssem` includes one single newline, adds it to the
   * `lines` mutator.
   */
  const outputMutOp = (op: Op) => {
    if (!lineAssem) {
      lineAssem = new MergingOpAssembler();
    }
    lineAssem!.append(op);
    if (op.lines <= 0) return;
    assert(op.lines === 1, `Can't have op.lines of ${op.lines} in attribution lines`);
    // ship it to the mut
    mut.insert(lineAssem!.toString(), 1);
    lineAssem = null;
  };

  let csOp = new Op();
  let attOp = new Op();
  while (csOp.opcode || !csOpsNext.done || attOp.opcode || isNextMutOp()) {
    if (!csOp.opcode && !csOpsNext.done) {
      // coOp done, but more ops in cs.
      csOp = csOpsNext.value;
      csOpsNext = csOps.next();
    }
    if (!csOp.opcode && !attOp.opcode && !lineAssem && !lineOpsHasNext()) {
      break; // done
    } else if (csOp.opcode === '=' && csOp.lines > 0 && !csOp.attribs && !attOp.opcode &&
      !lineAssem && !lineOpsHasNext()) {
      // Skip multiple lines without attributes; this is what makes small changes not order of the
      // document size.
      mut.skipLines(csOp.lines);
      csOp.opcode = '';
    } else if (csOp.opcode === '+') {
      const opOut = copyOp(csOp);
      if (csOp.lines > 1) {
        // Copy the first line from `csOp` to `opOut`.
        const firstLineLen = csBank.indexOf('\n', csBankIndex) + 1 - csBankIndex;
        csOp.chars -= firstLineLen;
        csOp.lines--;
        opOut.lines = 1;
        opOut.chars = firstLineLen;
      } else {
        // Either one or no newlines in '+' `csOp`, copy to `opOut` and reset `csOp`.
        csOp.opcode = '';
      }
      outputMutOp(opOut);
      csBankIndex += opOut.chars;
    } else {
      if (!attOp.opcode && isNextMutOp()) attOp = nextMutOp();
      const opOut = slicerZipperFunc(attOp, csOp, pool);
      if (opOut.opcode) outputMutOp(opOut);
    }
  }

  assert(!lineAssem, `line assembler not finished:${cs}`);
  mut.close();
};

/**
 * Function used as parameter for applyZip to apply a Changeset to an attribute.
 *
 * @param {Op} attOp - The op from the sequence that is being operated on, either an attribution
 *     string or the earlier of two exportss being composed.
 * @param {Op} csOp -
 * @param {AttributePool.ts} pool - Can be null if definitely not needed.
 * @returns {Op} The result of applying `csOp` to `attOp`.
 */
export const slicerZipperFunc = (attOp: Op, csOp: Op, pool: AttributePool|null):Op => {
  const opOut = new Op();
  if (!attOp.opcode) {
    copyOp(csOp, opOut);
    csOp.opcode = '';
  } else if (!csOp.opcode) {
    copyOp(attOp, opOut);
    attOp.opcode = '';
  } else if (attOp.opcode === '-') {
    copyOp(attOp, opOut);
    attOp.opcode = '';
  } else if (csOp.opcode === '+') {
    copyOp(csOp, opOut);
    csOp.opcode = '';
  } else {
    for (const op of [attOp, csOp]) {
      assert(op.chars >= op.lines, `op has more newlines than chars: ${op.toString()}`);
    }
    assert(
      attOp.chars < csOp.chars ? attOp.lines <= csOp.lines
        : attOp.chars > csOp.chars ? attOp.lines >= csOp.lines
          : attOp.lines === csOp.lines,
      'line count mismatch when composing changesets A*B; ' +
      `opA: ${attOp.toString()} opB: ${csOp.toString()}`);
    assert(['+', '='].includes(attOp.opcode), `unexpected opcode in op: ${attOp.toString()}`);
    assert(['-', '='].includes(csOp.opcode), `unexpected opcode in op: ${csOp.toString()}`);
    opOut.opcode = {
      '+': {
        '-': '', // The '-' cancels out (some of) the '+', leaving any remainder for the next call.
        '=': '+',
      },
      '=': {
        '-': '-',
        '=': '=',
      },
    }[attOp.opcode][csOp.opcode] as OpCode;
    const [fullyConsumedOp, partiallyConsumedOp] = [attOp, csOp].sort((a, b) => a.chars - b.chars);
    opOut.chars = fullyConsumedOp.chars;
    opOut.lines = fullyConsumedOp.lines;
    opOut.attribs = csOp.opcode === '-'
      // csOp is a remove op and remove ops normally never have any attributes, so this should
      // normally be the empty string. However, padDiff.js adds attributes to remove ops and needs
      // them preserved so they are copied here.
      ? csOp.attribs
      : composeAttributes(attOp.attribs, csOp.attribs, attOp.opcode === '=', pool);
    partiallyConsumedOp.chars -= fullyConsumedOp.chars;
    partiallyConsumedOp.lines -= fullyConsumedOp.lines;
    if (!partiallyConsumedOp.chars) partiallyConsumedOp.opcode = '';
    fullyConsumedOp.opcode = '';
  }
  return opOut;
};

/**
 * Applies a Changeset to the attribs string of a AText.
 *
 * @param {string} cs - Changeset
 * @param {string} astr - the attribs string of a AText
 * @param {AttributePool.ts} pool - the attibutes pool
 * @returns {string}
 */
export const applyToAttribution = (cs: string, astr: string, pool: AttributePool): string => {
  const unpacked = unpack(cs);
  return applyZip(astr, unpacked.ops, (op1: Op, op2:Op) => slicerZipperFunc(op1, op2, pool));
};

/**
 * Joins several Attribution lines.
 *
 * @param {string[]} theAlines - collection of Attribution lines
 * @returns {string} joined Attribution lines
 */
export const joinAttributionLines = (theAlines: string[]): string => {
  const assem = new MergingOpAssembler();
  for (const aline of theAlines) {
    for (const op of deserializeOps(aline)) assem.append(op);
  }
  return assem.toString();
};

export const splitAttributionLines = (attrOps: string, text: string) => {
  const assem = new MergingOpAssembler();
  const lines: string[] = [];
  let pos = 0;

  const appendOp = (op:Op) => {
    assem.append(op);
    if (op.lines > 0) {
      lines.push(assem.toString());
      assem.clear();
    }
    pos += op.chars;
  };

  for (const op of deserializeOps(attrOps)) {
    let numChars = op.chars;
    let numLines = op.lines;
    while (numLines > 1) {
      const newlineEnd = text.indexOf('\n', pos) + 1;
      assert(newlineEnd > 0, 'newlineEnd <= 0 in splitAttributionLines');
      op.chars = newlineEnd - pos;
      op.lines = 1;
      appendOp(op);
      numChars -= op.chars;
      numLines -= op.lines;
    }
    if (numLines === 1) {
      op.chars = numChars;
      op.lines = 1;
    }
    appendOp(op);
  }

  return lines;
};

/**
 * Splits text into lines.
 *
 * @param {string} text - text to split
 * @returns {string[]}
 */
export const splitTextLines = (text:string) => text.match(/[^\n]*(?:\n|[^\n]$)/g);

/**
 * Compose two Changesets.
 *
 * @param {string} cs1 - first Changeset
 * @param {string} cs2 - second Changeset
 * @param {AttributePool.ts} pool - Attribs pool
 * @returns {string}
 */
export const compose = (cs1: string, cs2:string, pool: AttributePool): string => {
  const unpacked1 = unpack(cs1);
  const unpacked2 = unpack(cs2);
  const len1 = unpacked1.oldLen;
  const len2 = unpacked1.newLen;
  assert(len2 === unpacked2.oldLen, 'mismatched composition of two changesets');
  const len3 = unpacked2.newLen;
  const bankIter1 = new StringIterator(unpacked1.charBank);
  const bankIter2 = new StringIterator(unpacked2.charBank);
  const bankAssem = new StringAssembler();

  const newOps = applyZip(unpacked1.ops, unpacked2.ops, (op1: Op, op2: Op) => {
    const op1code = op1.opcode;
    const op2code = op2.opcode;
    if (op1code === '+' && op2code === '-') {
      bankIter1.skip(Math.min(op1.chars, op2.chars));
    }
    const opOut = slicerZipperFunc(op1, op2, pool);
    if (opOut.opcode === '+') {
      if (op2code === '+') {
        bankAssem.append(bankIter2.take(opOut.chars));
      } else {
        bankAssem.append(bankIter1.take(opOut.chars));
      }
    }
    return opOut;
  });

  return pack(len1, len3, newOps, bankAssem.toString());
};

/**
 * Returns a function that tests if a string of attributes (e.g. '*3*4') contains a given attribute
 * key,value that is already present in the pool.
 *
 * @param {Attribute} attribPair - `[key, value]` pair of strings.
 * @param {AttributePool.ts} pool - Attribute pool
 * @returns {Function}
 */
export const attributeTester = (attribPair: Attribute, pool: AttributePool): Function => {
  const never = (attribs: Attribute[]) => false;
  if (!pool) return never;
  const attribNum = pool.putAttrib(attribPair, true);
  if (attribNum < 0) return never;
  const re = new RegExp(`\\*${numToString(attribNum)}(?!\\w)`);
  return (attribs: string) => re.test(attribs);
};

/**
 * Creates the identity Changeset of length N.
 *
 * @param {number} N - length of the identity changeset
 * @returns {string}
 */
export const identity = (N: number): string => pack(N, N, '', '');

/**
 * Creates a Changeset which works on oldFullText and removes text from spliceStart to
 * spliceStart+numRemoved and inserts newText instead. Also gives possibility to add attributes
 * optNewTextAPairs for the new text.
 *
 * @param {string} orig - Original text.
 * @param {number} start - Index into `orig` where characters should be removed and inserted.
 * @param {number} ndel - Number of characters to delete at `start`.
 * @param {string} ins - Text to insert at `start` (after deleting `ndel` characters).
 * @param {string} [attribs] - Optional attributes to apply to the inserted text.
 * @param {AttributePool.ts} [pool] - Attribute pool.
 * @returns {string}
 */
export const makeSplice = (orig: string, start: number, ndel: number, ins: string|null, attribs?: string | Attribute[] | undefined, pool?: AttributePool | null | undefined): string => {
  if (start < 0) throw new RangeError(`start index must be non-negative (is ${start})`);
  if (ndel < 0) throw new RangeError(`characters to delete must be non-negative (is ${ndel})`);
  if (start > orig.length) start = orig.length;
  if (ndel > orig.length - start) ndel = orig.length - start;
  const deleted = orig.substring(start, start + ndel);
  const assem = new SmartOpAssembler();
  const ops = (function* () {
    yield* opsFromText('=', orig.substring(0, start));
    yield* opsFromText('-', deleted);
    yield* opsFromText('+', ins as string, attribs, pool);
  })();
  for (const op of ops) assem.append(op);
  assem.endDocument();
  return pack(orig.length, orig.length + ins!.length - ndel, assem.toString(), ins!);
};

/**
 * Transforms a changeset into a list of splices in the form [startChar, endChar, newText] meaning
 * replace text from startChar to endChar with newText.
 *
 * @param {string} cs - Changeset
 * @returns {[number, number, string][]}
 */
const toSplices = (cs: string): [number, number, string][] => {
  const unpacked = unpack(cs);
  /** @type {[number, number, string][]} */
  const splices: [number, number, string][] = [];

  let oldPos = 0;
  const charIter = new StringIterator(unpacked.charBank);
  let inSplice = false;
  for (const op of deserializeOps(unpacked.ops)) {
    if (op.opcode === '=') {
      oldPos += op.chars;
      inSplice = false;
    } else {
      if (!inSplice) {
        splices.push([oldPos, oldPos, '']);
        inSplice = true;
      }
      if (op.opcode === '-') {
        oldPos += op.chars;
        splices[splices.length - 1][1] += op.chars;
      } else if (op.opcode === '+') {
        splices[splices.length - 1][2] += charIter.take(op.chars);
      }
    }
  }

  return splices;
};

/**
 * @param {string} cs -
 * @param {number} startChar -
 * @param {number} endChar -
 * @param {number} insertionsAfter -
 * @returns {[number, number]}
 */
export const characterRangeFollow = (cs: string, startChar: number, endChar: number, insertionsAfter: number):[number, number] => {
  let newStartChar = startChar;
  let newEndChar = endChar;
  let lengthChangeSoFar = 0;
  for (const splice of toSplices(cs)) {
    const spliceStart = splice[0] + lengthChangeSoFar;
    const spliceEnd = splice[1] + lengthChangeSoFar;
    const newTextLength = splice[2].length;
    const thisLengthChange = newTextLength - (spliceEnd - spliceStart);

    if (spliceStart <= newStartChar && spliceEnd >= newEndChar) {
      // splice fully replaces/deletes range
      // (also case that handles insertion at a collapsed selection)
      if (insertionsAfter) {
        newStartChar = newEndChar = spliceStart;
      } else {
        newStartChar = newEndChar = spliceStart + newTextLength;
      }
    } else if (spliceEnd <= newStartChar) {
      // splice is before range
      newStartChar += thisLengthChange;
      newEndChar += thisLengthChange;
    } else if (spliceStart >= newEndChar) {
      // splice is after range
    } else if (spliceStart >= newStartChar && spliceEnd <= newEndChar) {
      // splice is inside range
      newEndChar += thisLengthChange;
    } else if (spliceEnd < newEndChar) {
      // splice overlaps beginning of range
      newStartChar = spliceStart + newTextLength;
      newEndChar += thisLengthChange;
    } else {
      // splice overlaps end of range
      newEndChar = spliceStart;
    }

    lengthChangeSoFar += thisLengthChange;
  }

  return [newStartChar, newEndChar];
};

/**
 * Iterate over attributes in a changeset and move them from oldPool to newPool.
 *
 * @param {string} cs - Chageset/attribution string to iterate over
 * @param {AttributePool} oldPool - old attributes pool
 * @param {AttributePool} newPool - new attributes pool
 * @returns {string} the new Changeset
 */
export const moveOpsToNewPool = (cs: string, oldPool: AttributePool, newPool: AttributePool): string => {
  // works on exports or attribution string
  let dollarPos = cs.indexOf('$');
  if (dollarPos < 0) {
    dollarPos = cs.length;
  }
  const upToDollar = cs.substring(0, dollarPos);
  const fromDollar = cs.substring(dollarPos);
  // order of attribs stays the same
  return upToDollar.replace(/\*([0-9a-z]+)/g, (_, a) => {
    const oldNum = parseNum(a);
    const pair = oldPool.getAttrib(oldNum);
    // The attribute might not be in the old pool if the user is viewing the current revision in the
    // timeslider and text is deleted. See: https://github.com/ether/etherpad-lite/issues/3932
    if (!pair) return '';
    const newNum = newPool.putAttrib(pair);
    return `*${numToString(newNum)}`;
  }) + fromDollar;
};

/**
 * Create an attribution inserting a text.
 *
 * @param {string} text - text to insert
 * @returns {string}
 */
export const makeAttribution = (text: string) => {
  const assem = new SmartOpAssembler();
  for (const op of opsFromText('+', text)) assem.append(op);
  return assem.toString();
};

/**
 * Iterates over attributes in exports, attribution string, or attribs property of an op and runs
 * function func on them.
 *
 * @deprecated Use `attributes.decodeAttribString()` instead.
 * @param {string} cs - changeset
 * @param {Function} func - function to call
 */
export const eachAttribNumber = (cs: string, func: Function) => {
  padutils.warnDeprecated(
    'Changeset.eachAttribNumber() is deprecated; use attributes.decodeAttribString() instead');
  let dollarPos = cs.indexOf('$');
  if (dollarPos < 0) {
    dollarPos = cs.length;
  }
  const upToDollar = cs.substring(0, dollarPos);

  // WARNING: The following cannot be replaced with a call to `attributes.decodeAttribString()`
  // because that function only works on attribute strings, not serialized operations or changesets.
  upToDollar.replace(/\*([0-9a-z]+)/g, (_, a) => {
    func(parseNum(a));
    return '';
  });
};

/**
 * Filter attributes which should remain in a Changeset. Callable on a exports, attribution string,
 * or attribs property of an op, though it may easily create adjacent ops that can be merged.
 *
 * @param {string} cs - changeset to filter
 * @param {Function} filter - fnc which returns true if an attribute X (int) should be kept in the
 *     Changeset
 * @returns {string}
 */
export const filterAttribNumbers = (cs: string, filter: Function) => mapAttribNumbers(cs, filter);

/**
 * Does exactly the same as filterAttribNumbers.
 *
 * @param {string} cs -
 * @param {Function} func -
 * @returns {string}
 */
export const mapAttribNumbers = (cs: string, func: Function): string => {
  let dollarPos = cs.indexOf('$');
  if (dollarPos < 0) {
    dollarPos = cs.length;
  }
  const upToDollar = cs.substring(0, dollarPos);

  const newUpToDollar = upToDollar.replace(/\*([0-9a-z]+)/g, (s, a) => {
    const n = func(parseNum(a));
    if (n === true) {
      return s;
    } else if ((typeof n) === 'number') {
      return `*${numToString(n)}`;
    } else {
      return '';
    }
  });

  return newUpToDollar + cs.substring(dollarPos);
};

/**
 * Represents text with attributes.
 *
 * @typedef {object} AText
 * @property {string} attribs - Serialized sequence of insert operations that cover the text in
 *     `text`. These operations describe which parts of the text have what attributes.
 * @property {string} text - The text.
 */

/**
 * Create a Changeset going from Identity to a certain state.
 *
 * @param {string} text - text of the final change
 * @param {string} attribs - optional, operations which insert the text and also puts the right
 *     attributes
 * @returns {AText}
 */
export const makeAText = (text: string, attribs?: string): AText => ({
  text,
  attribs: (attribs || makeAttribution(text)),
});

/**
 * Apply a Changeset to a AText.
 *
 * @param {string} cs - Changeset to apply
 * @param {AText} atext -
 * @param {AttributePool.ts} pool - Attribute Pool to add to
 * @returns {AText}
 */
export const applyToAText = (cs: string, atext: AText, pool: AttributePool): AText => ({
  text: applyToText(cs, atext.text),
  attribs: applyToAttribution(cs, atext.attribs, pool),
});

/**
 * Clones a AText structure.
 *
 * @param {AText} atext -
 * @returns {AText}
 */
export const cloneAText = (atext: AText): AText => {
  if (!atext) error('atext is null');
  return {
    text: atext.text,
    attribs: atext.attribs,
  };
};

/**
 * Copies a AText structure from atext1 to atext2.
 *
 * @param {AText} atext1 -
 * @param {AText} atext2 -
 */
export const copyAText = (atext1: AText, atext2: AText) => {
  atext2.text = atext1.text;
  atext2.attribs = atext1.attribs;
};

/**
 * Convert AText to a series of operations. Strips final newline.
 *
 * @param {AText} atext - The AText to convert.
 * @yields {Op}
 * @returns {Generator<Op>}
 */
export const opsFromAText = function* (atext: AText): Generator<Op> {
  // intentionally skips last newline char of atext
  let lastOp = null;
  for (const op of deserializeOps(atext.attribs)) {
    if (lastOp != null) yield lastOp;
    lastOp = op;
  }
  if (lastOp == null) return;
  // exclude final newline
  if (lastOp.lines <= 1) {
    lastOp.lines = 0;
    lastOp.chars--;
  } else {
    const nextToLastNewlineEnd = atext.text.lastIndexOf('\n', atext.text.length - 2) + 1;
    const lastLineLength = atext.text.length - nextToLastNewlineEnd - 1;
    lastOp.lines--;
    lastOp.chars -= (lastLineLength + 1);
    yield copyOp(lastOp);
    lastOp.lines = 0;
    lastOp.chars = lastLineLength;
  }
  if (lastOp.chars) yield lastOp;
};

/**
 * Append the set of operations from atext to an assembler.
 *
 * @deprecated Use `opsFromAText` instead.
 * @param {AText} atext -
 * @param assem - Assembler like SmartOpAssembler TODO add desc
 */
export const appendATextToAssembler = (atext: AText, assem: SmartOpAssembler) => {
  padutils.warnDeprecated(
    'Changeset.appendATextToAssembler() is deprecated; use Changeset.opsFromAText() instead');
  for (const op of opsFromAText(atext)) assem.append(op);
};

type WirePrep = {
  translated: string,
  pool: AttributePool
}

/**
 * Creates a clone of a Changeset and it's APool.
 *
 * @param {string} cs -
 * @param {AttributePool.ts} pool -
 * @returns {{translated: string, pool: AttributePool.ts}}
 */
export const prepareForWire = (cs: string, pool: AttributePool): WirePrep => {
  const newPool = new AttributePool();
  const newCs = moveOpsToNewPool(cs, pool, newPool);
  return {
    translated: newCs,
    pool: newPool,
  };
};

/**
 * Checks if a changeset s the identity changeset.
 *
 * @param {string} cs -
 * @returns {boolean}
 */
export const isIdentity = (cs: string): boolean => {
  const unpacked = unpack(cs);
  return unpacked.ops === '' && unpacked.oldLen === unpacked.newLen;
};

/**
 * @deprecated Use an AttributeMap instead.
 */
const _attribsAttributeValue = (attribs: string, key: string, pool: AttributePool) => {
  if (!attribs) return '';
  for (const [k, v] of attribsFromString(attribs, pool)) {
    if (k === key) return v;
  }
  return '';
};

/**
 * Returns all the values of attributes with a certain key in an Op attribs string.
 *
 * @deprecated Use an AttributeMap instead.
 * @param {Op} op - Op
 * @param {string} key - string to search for
 * @param {AttributePool.ts} pool - attribute pool
 * @returns {string}
 */
export const opAttributeValue = (op: Op, key: string, pool: AttributePool):string => {
  padutils.warnDeprecated(
    'Changeset.opAttributeValue() is deprecated; use an AttributeMap instead');
  return _attribsAttributeValue(op.attribs, key, pool);
};

/**
 * Returns all the values of attributes with a certain key in an attribs string.
 *
 * @deprecated Use an AttributeMap instead.
 * @param {AttributeString} attribs - Attribute string
 * @param {string} key - string to search for
 * @param {AttributePool.ts} pool - attribute pool
 * @returns {string}
 */
export const attribsAttributeValue = (attribs: string, key: string, pool: AttributePool) => {
  padutils.warnDeprecated(
    'Changeset.attribsAttributeValue() is deprecated; use an AttributeMap instead');
  return _attribsAttributeValue(attribs, key, pool);
};



/**
 * Constructs an attribute string from a sequence of attributes.
 *
 * @deprecated Use `AttributeMap.prototype.toString()` or `attributes.attribsToString()` instead.
 * @param {string} opcode - The opcode for the Op that will get the resulting attribute string.
 * @param {?(Iterable<Attribute>|AttributeString)} attribs - The attributes to insert into the pool
 *     (if necessary) and encode. If an attribute string, no checking is performed to ensure that
 *     the attributes exist in the pool, are in the canonical order, and contain no duplicate keys.
 *     If this is an iterable of attributes, `pool` must be non-null.
 * @param {AttributePool.ts} pool - Attribute pool. Required if `attribs` is an iterable of attributes,
 *     ignored if `attribs` is an attribute string.
 * @returns {AttributeString}
 */
export const makeAttribsString = (opcode: string, attribs: Attribute[]|string, pool: AttributePool | null | undefined): string => {
  padutils.warnDeprecated(
    'Changeset.makeAttribsString() is deprecated; ' +
    'use AttributeMap.prototype.toString() or attributes.attribsToString() instead');
  if (!attribs || !['=', '+'].includes(opcode)) return '';
  if (typeof attribs === 'string') return attribs;
  return new AttributeMap(pool).update(attribs, opcode === '+').toString();
};

/**
 * Like "substring" but on a single-line attribution string.
 */
export const subattribution = (astr: string, start: number, optEnd?: number) => {
  const attOps = deserializeOps(astr);
  let attOpsNext = attOps.next();
  const assem = new SmartOpAssembler();
  let attOp = new Op();
  const csOp = new Op();

  const doCsOp = () => {
    if (!csOp.chars) return;
    while (csOp.opcode && (attOp.opcode || !attOpsNext.done)) {
      if (!attOp.opcode) {
        attOp = attOpsNext.value as Op;
        attOpsNext = attOps.next();
      }
      if (csOp.opcode && attOp.opcode && csOp.chars >= attOp.chars &&
        attOp.lines > 0 && csOp.lines <= 0) {
        csOp.lines++;
      }
      const opOut = slicerZipperFunc(attOp, csOp, null);
      if (opOut.opcode) assem.append(opOut);
    }
  };

  csOp.opcode = '-';
  csOp.chars = start;

  doCsOp();

  if (optEnd === undefined) {
    if (attOp.opcode) {
      assem.append(attOp);
    }
    while (!attOpsNext.done) {
      assem.append(attOpsNext.value);
      attOpsNext = attOps.next();
    }
  } else {
    csOp.opcode = '=';
    csOp.chars = optEnd - start;
    doCsOp();
  }

  return assem.toString();
};

export const inverse = (cs: string, lines: string|RegExpMatchArray|string[] | null, alines: string[]|{
  get: (idx: number) => string,
}, pool: AttributePool) => {
  // lines and alines are what the exports is meant to apply to.
  // They may be arrays or objects with .get(i) and .length methods.
  // They include final newlines on lines.

  const linesGet = (idx: number) => {
    // @ts-ignore
    if ("get" in lines) {
      // @ts-ignore
      return lines.get(idx);
    } else {
      return lines![idx];
    }
  };

  /**
   * @param {number} idx -
   * @returns {string}
   */
  const alinesGet = (idx: number): string => {
    // @ts-ignore
    if ("get" in alines) {
      return alines.get(idx);
    } else {
      return alines[idx];
    }
  };

  let curLine = 0;
  let curChar = 0;
  let curLineOps: null|Generator<Op> = null;
  let curLineOpsNext:IteratorResult<Op>|null = null;
  let curLineOpsLine: number;
  let curLineNextOp = new Op('+');

  const unpacked = unpack(cs);
  const builder = new Builder(unpacked.newLen);

  const consumeAttribRuns = (numChars: number, func: Function /* (len, attribs, endsLine)*/) => {
    if (!curLineOps || curLineOpsLine !== curLine) {
      curLineOps = deserializeOps(alinesGet(curLine));
      curLineOpsNext = curLineOps.next();
      curLineOpsLine = curLine;
      let indexIntoLine = 0;
      while (!curLineOpsNext.done) {
        curLineNextOp = curLineOpsNext.value;
        curLineOpsNext = curLineOps.next();
        if (indexIntoLine + curLineNextOp.chars >= curChar) {
          curLineNextOp.chars -= (curChar - indexIntoLine);
          break;
        }
        indexIntoLine += curLineNextOp.chars;
      }
    }

    while (numChars > 0) {
      if (!curLineNextOp.chars && curLineOpsNext!.done) {
        curLine++;
        curChar = 0;
        curLineOpsLine = curLine;
        curLineNextOp.chars = 0;
        curLineOps = deserializeOps(alinesGet(curLine));
        curLineOpsNext = curLineOps!.next();
      }
      if (!curLineNextOp.chars) {
        if (curLineOpsNext!.done) {
          curLineNextOp = new Op();
        } else {
          curLineNextOp = curLineOpsNext!.value;
          curLineOpsNext = curLineOps.next();
        }
      }
      const charsToUse = Math.min(numChars, curLineNextOp.chars);
      func(charsToUse, curLineNextOp.attribs, charsToUse === curLineNextOp.chars &&
        curLineNextOp.lines > 0);
      numChars -= charsToUse;
      curLineNextOp.chars -= charsToUse;
      curChar += charsToUse;
    }

    if (!curLineNextOp.chars && curLineOpsNext!.done) {
      curLine++;
      curChar = 0;
    }
  };

  const skip = (N: number, L: number) => {
    if (L) {
      curLine += L;
      curChar = 0;
    } else if (curLineOps && curLineOpsLine === curLine) {
      consumeAttribRuns(N, () => {});
    } else {
      curChar += N;
    }
  };

  const nextText = (numChars: number) => {
    let len = 0;
    const assem = new StringAssembler();
    const firstString = linesGet(curLine).substring(curChar);
    len += firstString.length;
    assem.append(firstString);

    let lineNum = curLine + 1;
    while (len < numChars) {
      const nextString = linesGet(lineNum);
      len += nextString.length;
      assem.append(nextString);
      lineNum++;
    }

    return assem.toString().substring(0, numChars);
  };

  const cachedStrFunc = (func: Function) => {
    const cache:{
      [key: string]: string
    } = {};
    return (s: string | number) => {
      if (!cache[s]) {
        cache[s] = func(s);
      }
      return cache[s];
    };
  };

  for (const csOp of deserializeOps(unpacked.ops)) {
    if (csOp.opcode === '=') {
      if (csOp.attribs) {
        const attribs = AttributeMap.fromString(csOp.attribs, pool);
        const undoBackToAttribs = cachedStrFunc((oldAttribsStr: string) => {
          const oldAttribs = AttributeMap.fromString(oldAttribsStr, pool);
          const backAttribs = new AttributeMap(pool);
          for (const [key, value] of attribs) {
            const oldValue = oldAttribs.get(key) || '';
            if (oldValue !== value) backAttribs.set(key, oldValue);
          }
          // TODO: backAttribs does not restore removed attributes (it is missing attributes that
          // are in oldAttribs but not in attribs). I don't know if that is intentional.
          return backAttribs.toString();
        });
        consumeAttribRuns(csOp.chars, (len: number, attribs: string, endsLine: number) => {
          builder.keep(len, endsLine ? 1 : 0, undoBackToAttribs(attribs));
        });
      } else {
        skip(csOp.chars, csOp.lines);
        builder.keep(csOp.chars, csOp.lines);
      }
    } else if (csOp.opcode === '+') {
      builder.remove(csOp.chars, csOp.lines);
    } else if (csOp.opcode === '-') {
      const textBank = nextText(csOp.chars);
      let textBankIndex = 0;
      consumeAttribRuns(csOp.chars, (len: number, attribs: string) => {
        builder.insert(textBank.substr(textBankIndex, len), attribs);
        textBankIndex += len;
      });
    }
  }

  return checkRep(builder.toString());
};

// %CLIENT FILE ENDS HERE%
export const follow = (cs1: string, cs2:string, reverseInsertOrder: boolean, pool: AttributePool) => {
  const unpacked1 = unpack(cs1);
  const unpacked2 = unpack(cs2);
  const len1 = unpacked1.oldLen;
  const len2 = unpacked2.oldLen;
  assert(len1 === len2, 'mismatched follow - cannot transform cs1 on top of cs2');
  const chars1 = new StringIterator(unpacked1.charBank);
  const chars2 = new StringIterator(unpacked2.charBank);

  const oldLen = unpacked1.newLen;
  let oldPos = 0;
  let newLen = 0;

  const hasInsertFirst = attributeTester(['insertorder', 'first'], pool);

  const newOps = applyZip(unpacked1.ops, unpacked2.ops, (op1: Op, op2: Op) => {
    const opOut = new Op();
    if (op1.opcode === '+' || op2.opcode === '+') {
      let whichToDo;
      if (op2.opcode !== '+') {
        whichToDo = 1;
      } else if (op1.opcode !== '+') {
        whichToDo = 2;
      } else {
        // both +
        const firstChar1 = chars1.peek(1);
        const firstChar2 = chars2.peek(1);
        const insertFirst1 = hasInsertFirst(op1.attribs);
        const insertFirst2 = hasInsertFirst(op2.attribs);
        if (insertFirst1 && !insertFirst2) {
          whichToDo = 1;
        } else if (insertFirst2 && !insertFirst1) {
          whichToDo = 2;
        } else if (firstChar1 === '\n' && firstChar2 !== '\n') {
          // insert string that doesn't start with a newline first so as not to break up lines
          whichToDo = 2;
        } else if (firstChar1 !== '\n' && firstChar2 === '\n') {
          whichToDo = 1;
        } else if (reverseInsertOrder) {
          // break symmetry:
          whichToDo = 2;
        } else {
          whichToDo = 1;
        }
      }
      if (whichToDo === 1) {
        chars1.skip(op1.chars);
        opOut.opcode = '=';
        opOut.lines = op1.lines;
        opOut.chars = op1.chars;
        opOut.attribs = '';
        op1.opcode = '';
      } else {
        // whichToDo == 2
        chars2.skip(op2.chars);
        copyOp(op2, opOut);
        op2.opcode = '';
      }
    } else if (op1.opcode === '-') {
      if (!op2.opcode) {
        op1.opcode = '';
      } else if (op1.chars <= op2.chars) {
        op2.chars -= op1.chars;
        op2.lines -= op1.lines;
        op1.opcode = '';
        if (!op2.chars) {
          op2.opcode = '';
        }
      } else {
        op1.chars -= op2.chars;
        op1.lines -= op2.lines;
        op2.opcode = '';
      }
    } else if (op2.opcode === '-') {
      copyOp(op2, opOut);
      if (!op1.opcode) {
        op2.opcode = '';
      } else if (op2.chars <= op1.chars) {
        // delete part or all of a keep
        op1.chars -= op2.chars;
        op1.lines -= op2.lines;
        op2.opcode = '';
        if (!op1.chars) {
          op1.opcode = '';
        }
      } else {
        // delete all of a keep, and keep going
        opOut.lines = op1.lines;
        opOut.chars = op1.chars;
        op2.lines -= op1.lines;
        op2.chars -= op1.chars;
        op1.opcode = '';
      }
    } else if (!op1.opcode) {
      copyOp(op2, opOut);
      op2.opcode = '';
    } else if (!op2.opcode) {
      // @NOTE: Critical bugfix for EPL issue #1625. We do not copy op1 here
      // in order to prevent attributes from leaking into result changesets.
      // copyOp(op1, opOut);
      op1.opcode = '';
    } else {
      // both keeps
      opOut.opcode = '=';
      opOut.attribs = followAttributes(op1.attribs, op2.attribs, pool);
      if (op1.chars <= op2.chars) {
        opOut.chars = op1.chars;
        opOut.lines = op1.lines;
        op2.chars -= op1.chars;
        op2.lines -= op1.lines;
        op1.opcode = '';
        if (!op2.chars) {
          op2.opcode = '';
        }
      } else {
        opOut.chars = op2.chars;
        opOut.lines = op2.lines;
        op1.chars -= op2.chars;
        op1.lines -= op2.lines;
        op2.opcode = '';
      }
    }
    switch (opOut.opcode) {
      case '=':
        oldPos += opOut.chars;
        newLen += opOut.chars;
        break;
      case '-':
        oldPos += opOut.chars;
        break;
      case '+':
        newLen += opOut.chars;
        break;
    }
    return opOut;
  });
  newLen += oldLen - oldPos;

  return pack(oldLen, newLen, newOps, unpacked2.charBank);
};

const followAttributes = (att1: string, att2: string, pool: AttributePool) => {
  // The merge of two sets of attribute changes to the same text
  // takes the lexically-earlier value if there are two values
  // for the same key.  Otherwise, all key/value changes from
  // both attribute sets are taken.  This operation is the "follow",
  // so a set of changes is produced that can be applied to att1
  // to produce the merged set.
  if ((!att2) || (!pool)) return '';
  if (!att1) return att2;
  const atts = new Map();
  att2.replace(/\*([0-9a-z]+)/g, (_, a) => {
    const [key, val] = pool.getAttrib(parseNum(a));
    atts.set(key, val);
    return '';
  });
  att1.replace(/\*([0-9a-z]+)/g, (_, a) => {
    const [key, val] = pool.getAttrib(parseNum(a));
    if (atts.has(key) && val <= atts.get(key)) atts.delete(key);
    return '';
  });
  // we've only removed attributes, so they're already sorted
  const buf = new StringAssembler();
  for (const att of atts) {
    buf.append('*');
    buf.append(numToString(pool.putAttrib(att)));
  }
  return buf.toString();
};

export const exportedForTestingOnly = {
  TextLinesMutator,
  followAttributes,
  toSplices,
};
