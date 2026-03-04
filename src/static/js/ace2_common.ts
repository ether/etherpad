'use strict';

/**
 * This code is mostly from the old Etherpad. Please help us to comment this code.
 * This helps other people to understand this code better and helps them to improve it.
 * TL;DR COMMENTS ON THIS FILE ARE HIGHLY APPRECIATED
 */

import {MapArrayType} from "../../node/types/MapType";

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

export const isNodeText = (node: {
  nodeType: number
}) => (node.nodeType === 3);

export const getAssoc = (obj: MapArrayType<any>, name: string) => obj[`_magicdom_${name}`];

export const setAssoc = (obj: MapArrayType<any>, name: string, value: string) => {
  // note that in IE designMode, properties of a node can get
  // copied to new nodes that are spawned during editing; also,
  // properties representable in HTML text can survive copy-and-paste
  obj[`_magicdom_${name}`] = value;
};

// "func" is a function over 0..(numItems-1) that is monotonically
// "increasing" with index (false, then true).  Finds the boundary
// between false and true, a number between 0 and numItems inclusive.


export const binarySearch = (numItems: number, func: (num: number)=>boolean) => {
  if (numItems < 1) return 0;
  if (func(0)) return 0;
  if (!func(numItems - 1)) return numItems;
  let low = 0; // func(low) is always false
  let high = numItems - 1; // func(high) is always true
  while ((high - low) > 1) {
    const x = Math.floor((low + high) / 2); // x != low, x != high
    if (func(x)) high = x;
    else low = x;
  }
  return high;
};

export const binarySearchInfinite = (expectedLength: number, func: (num: number)=>boolean) => {
  let i = 0;
  while (!func(i)) i += expectedLength;
  return binarySearch(i, func);
};

export const noop = () => {};
