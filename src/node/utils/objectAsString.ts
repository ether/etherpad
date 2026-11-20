'use strict';

// Renders client-supplied diagnostic data as a single log line. The input
// comes from an unauthenticated endpoint, so both nesting depth and output
// length are bounded: deep nesting would otherwise overflow the stack, and
// the whole body would otherwise be copied into the log.
export const MAX_DEPTH = 8;
export const MAX_LENGTH = 4096;

type Budget = {left: number};

const renderValue = (value: any, depth: number, budget: Budget): string => {
  if (Array.isArray(value)) {
    if (depth >= MAX_DEPTH) return '[...]';
    const parts: string[] = [];
    for (const item of value) {
      if (budget.left <= 0) { parts.push('...'); break; }
      const part = renderValue(item, depth + 1, budget);
      budget.left -= part.length + 1;
      parts.push(part);
    }
    return parts.join(',');
  }
  if (typeof value === 'object' && value !== null) {
    return depth >= MAX_DEPTH ? '{...}' : `{${renderObject(value, depth + 1, budget)}}`;
  }
  return `${value}`;
};

const renderObject = (obj: any, depth: number, budget: Budget): string => {
  let output = '';
  for (const property in obj) {
    if (budget.left <= 0) return `${output}...`;
    if (!Object.prototype.hasOwnProperty.call(obj, property)) continue;
    const value = obj[property];
    if (typeof value === 'function') continue;
    const part = `${property}: ${renderValue(value, depth, budget)}; `;
    budget.left -= part.length;
    output += part;
  }
  return output;
};

export const objectAsString = (obj: any): string => {
  const output = renderObject(obj, 0, {left: MAX_LENGTH});
  return output.length > MAX_LENGTH ? `${output.slice(0, MAX_LENGTH)}...` : output;
};
