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
 * @typedef {Attribute[]} NumToAttrib
 */

/**
 * An intermediate representation of the contents of an attribute pool, suitable for serialization
 * via `JSON.stringify` and transmission to another user.
 *
 * @typedef {Object} Jsonable
 * @property {Attribute[]} numToAttrib - The pool's attributes and their identifiers.
 * @property {number} nextNum - The attribute ID to assign to the next new attribute.
 */

import { Attribute } from "./types/Attribute";

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
  private _numToAttrib: [string, string][]
  private _attribToNum: Map<string, number>

  constructor() {
    /**
     * Maps an attribute identifier to the attribute's `[key, value]` string pair.
     * @private
     * @type {[string, string][]}
     */
    this._numToAttrib = []; // e.g. [['foo','bar']]

    /**
     * Maps the string representation of an attribute (`String([key, value])`) to its non-negative
     * identifier.
     * @private
     * @type {Map<string, number>}
     */
    this._attribToNum = new Map(); // e.g. new Map([['foo,bar', 0]])
  }

  get numToAttrib(): any {
    return this._numToAttrib;
  }

  get nextNum(): number {
    return this._numToAttrib.length;
  }

  /**
   * @returns {AttributePool} A deep copy of this attribute pool.
   */
  clone() {
    const c = new AttributePool();
    c._numToAttrib = this._numToAttrib.map(a => [a[0], a[1]]);
    c._attribToNum = new Map(this._attribToNum);
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
    const existing = this._attribToNum.get(str);
    if (existing !== undefined) {
      return existing;
    }
    if (dontAddIfAbsent) {
      return -1;
    }
    const num = this._numToAttrib.length;
    this._attribToNum.set(str, num);
    this._numToAttrib.push([String(attrib[0] || ''), String(attrib[1] || '')]);
    return num;
  }

  /**
   * @param {number} num - The identifier of the attribute to fetch.
   * @returns {Attribute} The attribute with the given identifier, or nullish if there is no such
   *     attribute.
   */
  getAttrib(num: number): Attribute | undefined {
    const pair = this._numToAttrib[num];
    if (!pair) {
      return pair as any;
    }
    return [pair[0], pair[1]]; // return a mutable copy
  }

  /**
   * @param {number} num - The identifier of the attribute to fetch.
   * @returns {string} Eqivalent to `getAttrib(num)[0]` if the attribute exists, otherwise the empty
   *     string.
   */
  getAttribKey(num: number): string {
    const pair = this._numToAttrib[num];
    if (!pair) return '';
    return pair[0];
  }

  /**
   * @param {number} num - The identifier of the attribute to fetch.
   * @returns {string} Eqivalent to `getAttrib(num)[1]` if the attribute exists, otherwise the empty
   *     string.
   */
  getAttribValue(num: number) {
    const pair = this._numToAttrib[num];
    if (!pair) return '';
    return pair[1];
  }

  /**
   * Executes a callback for each attribute in the pool.
   *
   * @param {Function} func - Callback to call with three arguments: key, value, and ID. Its return
   *     value is ignored.
   */
  eachAttrib(func: (k: string, v: string, i: number) => void) {
    this._numToAttrib.forEach((pair, i) => {
      if (pair) {
        func(pair[0], pair[1], i);
      }
    });
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
      numToAttrib: this._numToAttrib,
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
  fromJsonable(obj: any) {
    if (Array.isArray(obj.numToAttrib)) {
      this._numToAttrib = obj.numToAttrib.map((a: any) => [a[0], a[1]]);
    } else {
      this._numToAttrib = [];
      for (const [n, val] of Object.entries(obj.numToAttrib)) {
        this._numToAttrib[Number(n)] = val as [string, string];
      }
    }
    this._attribToNum = new Map();
    for (let i = 0; i < this._numToAttrib.length; i++) {
      if (this._numToAttrib[i]) {
        this._attribToNum.set(String(this._numToAttrib[i]), i);
      }
    }
    return this;
  }

  /**
   * Asserts that the data in the pool is consistent. Throws if inconsistent.
   */
  check() {
    if (!Number.isInteger(this.nextNum)) throw new Error('nextNum property is not an integer');
    if (this.nextNum < 0) throw new Error('nextNum property is negative');
    if (!Array.isArray(this._numToAttrib)) throw new TypeError('numToAttrib property is not an array');
    if (!(this._attribToNum instanceof Map)) throw new TypeError('attribToNum property is not a Map');

    if (this._numToAttrib.length !== this.nextNum) {
      throw new Error(`size mismatch (want ${this.nextNum}, got ${this._numToAttrib.length})`);
    }

    for (let i = 0; i < this.nextNum; ++i) {
      const attr = this._numToAttrib[i];
      if (!Array.isArray(attr)) throw new TypeError(`attrib ${i} is not an array`);
      if (attr.length !== 2) throw new Error(`attrib ${i} is not an array of length 2`);
      const [k, v] = attr;
      if (k == null) throw new TypeError(`attrib ${i} key is null`);
      if (typeof k !== 'string') throw new TypeError(`attrib ${i} key is not a string`);
      if (v == null) throw new TypeError(`attrib ${i} value is null`);
      if (typeof v !== 'string') throw new TypeError(`attrib ${i} value is not a string`);
      const attrStr = String(attr);
      if (this._attribToNum.get(attrStr) !== i) throw new Error(`attribToNum for ${attrStr} !== ${i}`);
    }
  }
}

export default AttributePool
