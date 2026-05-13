// Build a fallback path → comment map from `settings.json.template`. The live
// settings.json is per-developer and often lacks comments; the template is the
// authoritative source of per-key documentation.

import { parseTree, type JSONPath, type Node } from 'jsonc-parser';
import { extractAdjacentComments } from './comments';

// Injected by Vite at build time from settings.json.template (see vite.config.ts).
// Inlining at config time avoids widening the dev server's filesystem allowlist
// to the repo root, which would expose settings.json/credentials.json over the
// dev server.
declare const __SETTINGS_TEMPLATE__: string;
const templateText: string = __SETTINGS_TEMPLATE__;

const pathKey = (path: JSONPath): string => path.map(String).join('.');

const buildMap = (text: string): Map<string, string> => {
  const map = new Map<string, string>();
  const tree = parseTree(text, [], { allowTrailingComma: true });
  if (!tree) return map;

  const walk = (node: Node, path: JSONPath) => {
    if (node.type === 'object') {
      for (const prop of node.children ?? []) {
        if (prop.type !== 'property' || !prop.children || prop.children.length < 2) continue;
        const keyNode = prop.children[0];
        const valueNode = prop.children[1];
        if (keyNode.type !== 'string') continue;
        const childPath = [...path, String(keyNode.value)];
        const { leading, trailing } = extractAdjacentComments(
          text, prop.offset, valueNode.offset, valueNode.length,
        );
        if (leading || trailing) {
          map.set(pathKey(childPath), [leading, trailing].filter(Boolean).join(' — '));
        }
        walk(valueNode, childPath);
      }
    } else if (node.type === 'array') {
      (node.children ?? []).forEach((child, i) => walk(child, [...path, i]));
    }
  };

  walk(tree, []);
  return map;
};

const templateMap = buildMap(templateText);

export const lookupTemplateComment = (path: JSONPath): string | null =>
  templateMap.get(pathKey(path)) ?? null;
