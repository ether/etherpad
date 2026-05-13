// admin/src/components/settings/envPill.ts
//
// Detect `"${VAR}"` and `"${VAR:default}"` placeholders inside the raw
// slice of a string node. The slice INCLUDES the surrounding quotes,
// because jsonc-parser exposes node.offset/length over the whole literal.

export type EnvPlaceholder = {
  variable: string;
  defaultValue: string | null;
};

const RE = /^"\$\{([A-Za-z_][A-Za-z0-9_]*)(?::([^}]*))?\}"$/;

export const matchEnvPlaceholder = (rawSlice: string): EnvPlaceholder | null => {
  const m = RE.exec(rawSlice);
  if (!m) return null;
  return {
    variable: m[1],
    defaultValue: m[2] ?? null,
  };
};
