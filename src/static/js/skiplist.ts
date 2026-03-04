'use strict';

/**
 * This code is mostly from the old Etherpad. Please help us to comment this code.
 * This helps other people to understand this code better and helps them to improve it.
 * TL;DR COMMENTS ON THIS FILE ARE HIGHLY APPRECIATED
 */

/**
 * Copyright 2009 Google Inc.
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

const _entryWidth = (e: Entry) => (e && e.width) || 0;

type Entry = {
  key: string,
  value?: string
  width?: number
}

class Node {
  public key: string|null
  readonly entry: Entry|null
  levels: number
  upPtrs: Node[]
  downPtrs: Node[]
  downSkips: number[]
  readonly downSkipWidths: number[]

  constructor(entry: Entry|null, levels = 0, downSkips: number|null = 1, downSkipWidths:number|null  = 0) {
    this.key = entry != null ? entry.key : null;
    this.entry = entry;
    this.levels = levels;
    this.upPtrs = Array(levels).fill(null);
    this.downPtrs = Array(levels).fill(null);
    this.downSkips = Array(levels).fill(downSkips);
    this.downSkipWidths = Array(levels).fill(downSkipWidths);
  }

  propagateWidthChange() {
    const oldWidth = this.downSkipWidths[0];
    const newWidth = _entryWidth(this.entry!);
    const widthChange = newWidth - oldWidth;
    let n: Node = this;
    let lvl = 0;
    while (lvl < n.levels) {
      n.downSkipWidths[lvl] += widthChange;
      lvl++;
      while (lvl >= n.levels && n.upPtrs[lvl - 1]) {
        n = n.upPtrs[lvl - 1];
      }
    }
    return widthChange;
  }
}

// A "point" object at index x allows modifications immediately after the first x elements of the
// skiplist, such as multiple inserts or deletes. After an insert or delete using point P, the point
// is still valid and points to the same index in the skiplist. Other operations with other points
// invalidate this point.
class Point {
  private skipList: SkipList
  private readonly loc: number
  private readonly idxs: number[]
  private readonly nodes: Node[]
  private widthSkips: number[]

  constructor(skipList: SkipList, loc: number) {
    this.skipList = skipList;
    this.loc = loc;
    const numLevels = this.skipList.start.levels;
    let lvl = numLevels - 1;
    let i = -1;
    let ws = 0;
    const nodes: Node[] = new Array(numLevels);
    const idxs: number[] = new Array(numLevels);
    const widthSkips: number[] = new Array(numLevels);
    nodes[lvl] = this.skipList.start;
    idxs[lvl] = -1;
    widthSkips[lvl] = 0;
    while (lvl >= 0) {
      let n = nodes[lvl];
      while (n.downPtrs[lvl] && (i + n.downSkips[lvl] < this.loc)) {
        i += n.downSkips[lvl];
        ws += n.downSkipWidths[lvl];
        n = n.downPtrs[lvl];
      }
      nodes[lvl] = n;
      idxs[lvl] = i;
      widthSkips[lvl] = ws;
      lvl--;
      if (lvl >= 0) {
        nodes[lvl] = n;
      }
    }
    this.idxs = idxs;
    this.nodes = nodes;
    this.widthSkips = widthSkips;
  }

  toString() {
    return `Point(${this.loc})`;
  }

  insert(entry: Entry) {
    if (entry.key == null) throw new Error('entry.key must not be null');
    if (this.skipList.containsKey(entry.key)) {
      throw new Error(`an entry with key ${entry.key} already exists`);
    }

    const newNode = new Node(entry);
    const pNodes = this.nodes;
    const pIdxs = this.idxs;
    const pLoc = this.loc;
    const widthLoc = this.widthSkips[0] + this.nodes[0].downSkipWidths[0];
    const newWidth = _entryWidth(entry);

    // The new node will have at least level 1
    // With a proability of 0.01^(n-1) the nodes level will be >= n
    while (newNode.levels === 0 || Math.random() < 0.01) {
      const lvl = newNode.levels;
      newNode.levels++;
      if (lvl === pNodes.length) {
        // assume we have just passed the end of this.nodes, and reached one level greater
        // than the skiplist currently supports
        pNodes[lvl] = this.skipList.start;
        pIdxs[lvl] = -1;
        this.skipList.start.levels++;
        this.skipList.end.levels++;
        this.skipList.start.downPtrs[lvl] = this.skipList.end;
        this.skipList.end.upPtrs[lvl] = this.skipList.start;
        this.skipList.start.downSkips[lvl] = this.skipList.keyToNodeMap.size + 1;
        this.skipList.start.downSkipWidths[lvl] = this.skipList._totalWidth;
        this.widthSkips[lvl] = 0;
      }
      const me = newNode;
      const up = pNodes[lvl];
      const down = up.downPtrs[lvl];
      const skip1 = pLoc - pIdxs[lvl];
      const skip2 = up.downSkips[lvl] + 1 - skip1;
      up.downSkips[lvl] = skip1;
      up.downPtrs[lvl] = me;
      me.downSkips[lvl] = skip2;
      me.upPtrs[lvl] = up;
      me.downPtrs[lvl] = down;
      down.upPtrs[lvl] = me;
      const widthSkip1 = widthLoc - this.widthSkips[lvl];
      const widthSkip2 = up.downSkipWidths[lvl] + newWidth - widthSkip1;
      up.downSkipWidths[lvl] = widthSkip1;
      me.downSkipWidths[lvl] = widthSkip2;
    }
    for (let lvl = newNode.levels; lvl < pNodes.length; lvl++) {
      const up = pNodes[lvl];
      up.downSkips[lvl]++;
      up.downSkipWidths[lvl] += newWidth;
    }
    this.skipList.keyToNodeMap.set(newNode.key as string, newNode);
    this.skipList._totalWidth += newWidth;
  }

  delete() {
    const elem = this.nodes[0].downPtrs[0];
    const elemWidth = _entryWidth(elem.entry!);
    for (let i = 0; i < this.nodes.length; i++) {
      if (i < elem.levels) {
        const up = elem.upPtrs[i];
        const down = elem.downPtrs[i];
        const totalSkip = up.downSkips[i] + elem.downSkips[i] - 1;
        up.downPtrs[i] = down;
        down.upPtrs[i] = up;
        up.downSkips[i] = totalSkip;
        const totalWidthSkip = up.downSkipWidths[i] + elem.downSkipWidths[i] - elemWidth;
        up.downSkipWidths[i] = totalWidthSkip;
      } else {
        const up = this.nodes[i];
        up.downSkips[i]--;
        up.downSkipWidths[i] -= elemWidth;
      }
    }
    this.skipList.keyToNodeMap.delete(elem.key as string);
    this.skipList._totalWidth -= elemWidth;
  }

  getNode() {
    return this.nodes[0].downPtrs[0];
  }
}

/**
 * The skip-list contains "entries", JavaScript objects that each must have a unique "key"
 * property that is a string.
 */
class SkipList {
  start: Node
  end: Node
  _totalWidth: number
  keyToNodeMap: Map<string, Node>


  constructor() {
    // if there are N elements in the skiplist, "start" is element -1 and "end" is element N
    this.start = new Node(null, 1);
    this.end = new Node(null, 1, null, null);
    this._totalWidth = 0;
    this.keyToNodeMap = new Map();
    this.start.downPtrs[0] = this.end;
    this.end.upPtrs[0] = this.start;
  }

  _getNodeAtOffset(targetOffset: number) {
    let i = 0;
    let n = this.start;
    let lvl = this.start.levels - 1;
    while (lvl >= 0 && n.downPtrs[lvl]) {
      while (n.downPtrs[lvl] && (i + n.downSkipWidths[lvl] <= targetOffset)) {
        i += n.downSkipWidths[lvl];
        n = n.downPtrs[lvl];
      }
      lvl--;
    }
    if (n === this.start) return (this.start.downPtrs[0] || null);
    if (n === this.end) {
      return targetOffset === this._totalWidth ? (this.end.upPtrs[0] || null) : null;
    }
    return n;
  }

  _getNodeIndex(node: Node, byWidth?: boolean) {
    let dist = (byWidth ? 0 : -1);
    let n = node;
    while (n !== this.start) {
      const lvl = n.levels - 1;
      n = n.upPtrs[lvl];
      if (byWidth) dist += n.downSkipWidths[lvl];
      else dist += n.downSkips[lvl];
    }
    return dist;
  }

  totalWidth() { return this._totalWidth; }

  // Returns index of first entry such that entryFunc(entry) is truthy,
  // or length() if no such entry.  Assumes all falsy entries come before
  // all truthy entries.
  search(entryFunc: Function) {
    let low = this.start;
    let lvl = this.start.levels - 1;
    let lowIndex = -1;

    const f = (node: Node) => {
      if (node === this.start) return false;
      else if (node === this.end) return true;
      else return entryFunc(node.entry);
    };

    while (lvl >= 0) {
      let nextLow = low.downPtrs[lvl];
      while (!f(nextLow)) {
        lowIndex += low.downSkips[lvl];
        low = nextLow;
        nextLow = low.downPtrs[lvl];
      }
      lvl--;
    }
    return lowIndex + 1;
  }

  length() { return this.keyToNodeMap.size; }

  atIndex(i: number) {
    if (i < 0) console.warn(`atIndex(${i})`);
    if (i >= this.keyToNodeMap.size) console.warn(`atIndex(${i}>=${this.keyToNodeMap.size})`);
    return (new Point(this, i)).getNode().entry;
  }

  // differs from Array.splice() in that new elements are in an array, not varargs
  splice(start: number, deleteCount: number, newEntryArray: Entry[]) {
    if (start < 0) console.warn(`splice(${start}, ...)`);
    if (start + deleteCount > this.keyToNodeMap.size) {
      console.warn(`splice(${start}, ${deleteCount}, ...), N=${this.keyToNodeMap.size}`);
      console.warn('%s %s %s', typeof start, typeof deleteCount, typeof this.keyToNodeMap.size);
      console.trace();
    }

    if (!newEntryArray) newEntryArray = [];
    const pt = new Point(this, start);
    for (let i = 0; i < deleteCount; i++) pt.delete();
    for (let i = (newEntryArray.length - 1); i >= 0; i--) {
      const entry = newEntryArray[i];
      pt.insert(entry);
    }
  }

  next(entry: Entry) { return this.keyToNodeMap.get(entry.key)!.downPtrs[0].entry || null; }
  prev(entry: Entry) { return this.keyToNodeMap.get(entry.key)!.upPtrs[0].entry || null; }
  push(entry: Entry) { this.splice(this.keyToNodeMap.size, 0, [entry]); }

  slice(start: number, end: number) {
    // act like Array.slice()
    if (start === undefined) start = 0;
    else if (start < 0) start += this.keyToNodeMap.size;
    if (end === undefined) end = this.keyToNodeMap.size;
    else if (end < 0) end += this.keyToNodeMap.size;

    if (start < 0) start = 0;
    if (start > this.keyToNodeMap.size) start = this.keyToNodeMap.size;
    if (end < 0) end = 0;
    if (end > this.keyToNodeMap.size) end = this.keyToNodeMap.size;

    if (end <= start) return [];
    let n = this.atIndex(start);
    const array = [n];
    for (let i = 1; i < (end - start); i++) {
      n = this.next(n!);
      array.push(n);
    }
    return array;
  }

  atKey(key: string) { return this.keyToNodeMap.get(key)!.entry; }
  indexOfKey(key: string) { return this._getNodeIndex(this.keyToNodeMap.get(key)!); }
  indexOfEntry(entry: Entry) { return this.indexOfKey(entry.key); }
  containsKey(key: string) { return this.keyToNodeMap.has(key); }
  // gets the last entry starting at or before the offset
  atOffset(offset: number) { return this._getNodeAtOffset(offset)!.entry; }
  keyAtOffset(offset: number) { return this.atOffset(offset)!.key; }
  offsetOfKey(key: string) { return this._getNodeIndex(this.keyToNodeMap.get(key)!, true); }
  offsetOfEntry(entry: Entry) { return this.offsetOfKey(entry.key); }
  setEntryWidth(entry: Entry, width: number) {
    entry.width = width;
    this._totalWidth += this.keyToNodeMap.get(entry.key)!.propagateWidthChange();
  }
  offsetOfIndex(i: number) {
    if (i < 0) return 0;
    if (i >= this.keyToNodeMap.size) return this._totalWidth;
    return this.offsetOfEntry(this.atIndex(i)!);
  }
  indexOfOffset(offset: number) {
    if (offset <= 0) return 0;
    if (offset >= this._totalWidth) return this.keyToNodeMap.size;
    return this.indexOfEntry(this.atOffset(offset)!);
  }
}

export default SkipList
