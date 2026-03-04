'use strict';
/**
 * This code represents the Attribute Pool Object of the original Etherpad.
 * 90% of the code is still like in the original Etherpad
 * Look at https://github.com/ether/pad/blob/master/infrastructure/ace/www/easysync2.js
 * You can find a explanation what a attribute pool is here:
 * https://github.com/ether/etherpad-lite/blob/master/doc/easysync/easysync-notes.txt
 */

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

/**
 * A `[key, value]` pair of strings describing a text attribute.
 *
 * @typedef {[string, string]} Attribute
 */

/**
 * Maps an attribute's identifier to the attribute.
 *
 * @typedef {Object.<number, Attribute>} NumToAttrib
 */

/**
 * An intermediate representation of the contents of an attribute pool, suitable for serialization
 * via `JSON.stringify` and transmission to another user.
 *
 * @typedef {Object} Jsonable
 * @property {NumToAttrib} numToAttrib - The pool's attributes and their identifiers.
 * @property {number} nextNum - The attribute ID to assign to the next new attribute.
 */

import {Attribute} from "./types/Attribute";

/**
 * Represents an attribute pool, which is a collection of attributes (pairs of key and value
 * strings) along with their identifiers (non-negative integers).
 *
 * The attribute pool enables attribute interning: rather than including the key and value strings
 * in changesets, changesets reference attributes by their identifiers.
 *
 * There is one attribute pool per pad, and it includes every current and historical attribute used
 * in the pad.
 */
class AttributePool {
  numToAttrib: {
    [key: number]: [string, string]
  }
  private attribToNum: {
    [key: number]: [string, string]
  }
  private nextNum: number

  constructor() {
    /**
     * Maps an attribute identifier to the attribute's `[key, value]` string pair.
     *
     * TODO: Rename to `_numToAttrib` once all users have been migrated to call `getAttrib` instead
     * of accessing this directly.
     * @private
     * TODO: Convert to an array.
     * @type {NumToAttrib}
     */
    this.numToAttrib = {}; // e.g. {0: ['foo','bar']}

    /**
     * Maps the string representation of an attribute (`String([key, value])`) to its non-negative
     * identifier.
     *
     * TODO: Rename to `_attribToNum` once all users have been migrated to use `putAttrib` instead
     * of accessing this directly.
     * @private
     * TODO: Convert to a `Map` object.
     * @type {Object.<string, number>}
     */
    this.attribToNum = {}; // e.g. {'foo,bar': 0}

    /**
     * The attribute ID to assign to the next new attribute.
     *
     * TODO: This property will not be necessary once `numToAttrib` is converted to an array (just
     * push onto the array).
     *
     * @private
     * @type {number}
     */
    this.nextNum = 0;
  }

  /**
   * @returns {AttributePool} A deep copy of this attribute pool.
   */
  clone() {
    const c = new AttributePool();
    for (const [n, a] of Object.entries(this.numToAttrib)){
      // @ts-ignore
      c.numToAttrib[n] = [a[0], a[1]];
    }
    Object.assign(c.attribToNum, this.attribToNum);
    c.nextNum = this.nextNum;
    return c;
  }

  /**
   * Add an attribute to the attribute set, or query for an existing attribute identifier.
   *
   * @param {Attribute} attrib - The attribute's `[key, value]` pair of strings.
   * @param {boolean} [dontAddIfAbsent=false] - If true, do not insert the attribute into the pool
   *     if the attribute does not already exist in the pool. This can be used to test for
   *     membership in the pool without mutating the pool.
   * @returns {number} The attribute's identifier, or -1 if the attribute is not in the pool.
   */
  putAttrib(attrib: Attribute, dontAddIfAbsent = false) {
    const str = String(attrib);
    if (str in this.attribToNum) {
      // @ts-ignore
      return this.attribToNum[str];
    }
    if (dontAddIfAbsent) {
      return -1;
    }
    const num = this.nextNum++;
    // @ts-ignore
    this.attribToNum[str] = num;
    this.numToAttrib[num] = [String(attrib[0] || ''), String(attrib[1] || '')];
    return num;
  }

  /**
   * @param {number} num - The identifier of the attribute to fetch.
   * @returns {Attribute} The attribute with the given identifier, or nullish if there is no such
   *     attribute.
   */
  getAttrib(num: number): Attribute {
    const pair = this.numToAttrib[num];
    if (!pair) {
      return pair;
    }
    return [pair[0], pair[1]]; // return a mutable copy
  }

  /**
   * @param {number} num - The identifier of the attribute to fetch.
   * @returns {string} Eqivalent to `getAttrib(num)[0]` if the attribute exists, otherwise the empty
   *     string.
   */
  getAttribKey(num: number): string {
    const pair = this.numToAttrib[num];
    if (!pair) return '';
    return pair[0];
  }

  /**
   * @param {number} num - The identifier of the attribute to fetch.
   * @returns {string} Eqivalent to `getAttrib(num)[1]` if the attribute exists, otherwise the empty
   *     string.
   */
  getAttribValue(num: number) {
    const pair = this.numToAttrib[num];
    if (!pair) return '';
    return pair[1];
  }

  /**
   * Executes a callback for each attribute in the pool.
   *
   * @param {Function} func - Callback to call with two arguments: key and value. Its return value
   *     is ignored.
   */
  eachAttrib(func: (k: string, v: string)=>void) {
    for (const n in this.numToAttrib) {
      const pair = this.numToAttrib[n];
      func(pair[0], pair[1]);
    }
  }

  /**
   * @returns {Jsonable} An object that can be passed to `fromJsonable` to reconstruct this
   *     attribute pool. The returned object can be converted to JSON. WARNING: The returned object
   *     has references to internal state (it is not a deep copy). Use the `clone()` method to copy
   *     a pool -- do NOT do `new AttributePool().fromJsonable(pool.toJsonable())` to copy because
   *     the resulting shared state will lead to pool corruption.
   */
  toJsonable() {
    return {
      numToAttrib: this.numToAttrib,
      nextNum: this.nextNum,
    };
  }

  /**
   * Replace the contents of this attribute pool with values from a previous call to `toJsonable`.
   *
   * @param {Jsonable} obj - Object returned by `toJsonable` containing the attributes and their
   *     identifiers. WARNING: This function takes ownership of the object (it does not make a deep
   *     copy). Use the `clone()` method to copy a pool -- do NOT do
   *     `new AttributePool().fromJsonable(pool.toJsonable())` to copy because the resulting shared
   *     state will lead to pool corruption.
   */
  fromJsonable(obj: this) {
    this.numToAttrib = obj.numToAttrib;
    this.nextNum = obj.nextNum;
    this.attribToNum = {};
    for (const n of Object.keys(this.numToAttrib)) {
      // @ts-ignore
      this.attribToNum[String(this.numToAttrib[n])] = Number(n);
    }
    return this;
  }

  /**
   * Asserts that the data in the pool is consistent. Throws if inconsistent.
   */
  check() {
    if (!Number.isInteger(this.nextNum)) throw new Error('nextNum property is not an integer');
    if (this.nextNum < 0) throw new Error('nextNum property is negative');
    for (const prop of ['numToAttrib', 'attribToNum']) {
      // @ts-ignore
      const obj = this[prop];
      if (obj == null) throw new Error(`${prop} property is null`);
      if (typeof obj !== 'object') throw new TypeError(`${prop} property is not an object`);
      const keys = Object.keys(obj);
      if (keys.length !== this.nextNum) {
        throw new Error(`${prop} size mismatch (want ${this.nextNum}, got ${keys.length})`);
      }
    }
    for (let i = 0; i < this.nextNum; ++i) {
      const attr = this.numToAttrib[`${i}`];
      if (!Array.isArray(attr)) throw new TypeError(`attrib ${i} is not an array`);
      if (attr.length !== 2) throw new Error(`attrib ${i} is not an array of length 2`);
      const [k, v] = attr;
      if (k == null) throw new TypeError(`attrib ${i} key is null`);
      if (typeof k !== 'string') throw new TypeError(`attrib ${i} key is not a string`);
      if (v == null) throw new TypeError(`attrib ${i} value is null`);
      if (typeof v !== 'string') throw new TypeError(`attrib ${i} value is not a string`);
      const attrStr = String(attr);
      // @ts-ignore
      if (this.attribToNum[attrStr] !== i) throw new Error(`attribToNum for ${attrStr} !== ${i}`);
    }
  }
}

export default AttributePool
