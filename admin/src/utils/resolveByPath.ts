import type { JSONPath } from 'jsonc-parser';

export const resolveByPath = (obj: unknown, path: JSONPath): unknown => {
  let cur: unknown = obj;
  for (const seg of path) {
    if (cur === null || cur === undefined) return undefined;
    if (typeof cur !== 'object') return undefined;
    if (Array.isArray(cur)) {
      const i = typeof seg === 'number' ? seg : Number(seg);
      if (!Number.isInteger(i)) return undefined;
      cur = cur[i];
    } else {
      cur = (cur as Record<string, unknown>)[String(seg)];
    }
  }
  return cur;
};
