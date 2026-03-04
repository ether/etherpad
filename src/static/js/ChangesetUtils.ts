'use strict';

/**
 * This module contains several helper Functions to build Changesets
 * based on a SkipList
 */

import {RepModel} from "./types/RepModel";
import {ChangeSetBuilder} from "./types/ChangeSetBuilder";
import {Attribute} from "./types/Attribute";
import AttributePool from "./AttributePool";
import {Builder} from "./Builder";

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
export const buildRemoveRange = (rep: RepModel, builder: ChangeSetBuilder, start: [number,number], end: [number, number]) => {
  const startLineOffset = rep.lines.offsetOfIndex(start[0]);
  const endLineOffset = rep.lines.offsetOfIndex(end[0]);

  if (end[0] > start[0]) {
    builder.remove(endLineOffset - startLineOffset - start[1], end[0] - start[0]);
    builder.remove(end[1]);
  } else {
    builder.remove(end[1] - start[1]);
  }
};

export const buildKeepRange = (rep: RepModel, builder: ChangeSetBuilder, start: [number, number], end:[number, number], attribs?: Attribute[], pool?: AttributePool) => {
  const startLineOffset = rep.lines.offsetOfIndex(start[0]);
  const endLineOffset = rep.lines.offsetOfIndex(end[0]);

  if (end[0] > start[0]) {
    builder.keep(endLineOffset - startLineOffset - start[1], end[0] - start[0], attribs, pool);
    builder.keep(end[1], 0, attribs, pool);
  } else {
    builder.keep(end[1] - start[1], 0, attribs, pool);
  }
};

export const buildKeepToStartOfRange = (rep: RepModel, builder: Builder, start: [number, number]) => {
  const startLineOffset = rep.lines.offsetOfIndex(start[0]);

  builder.keep(startLineOffset, start[0]);
  builder.keep(start[1]);
};

/**
 * Parses a number from string base 36.
 *
 * @param {string} str - string of the number in base 36
 * @returns {number} number
 */
export const parseNum = (str: string): number => parseInt(str, 36);

/**
 * Writes a number in base 36 and puts it in a string.
 *
 * @param {number} num - number
 * @returns {string} string
 */
export const numToString = (num: number): string => num.toString(36).toLowerCase();
