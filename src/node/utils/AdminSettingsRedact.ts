// Produce a clone of the in-memory settings object suitable for emitting
// to the admin SPA. Secrets are replaced with the sentinel "[REDACTED]"
// so the runtime values surface in the UI without leaking credentials.

const SENTINEL = '[REDACTED]';

// Path patterns. '*' matches any object key OR array index.
// A leaf matches if its full path equals one of these patterns.
const REDACT_PATHS: ReadonlyArray<ReadonlyArray<string>> = [
  ['users', '*', 'password'],
  ['users', '*', 'passwordHash'],
  ['users', '*', 'hash'],
  ['dbSettings', 'password'],
  ['dbSettings', 'user'],
  ['sso', 'clients', '*', 'client_secret'],
  ['sso', 'clients', '*', 'secret'],
  ['sessionKey'],
];

const pathMatches = (path: ReadonlyArray<string>): boolean => {
  for (const pattern of REDACT_PATHS) {
    if (pattern.length !== path.length) continue;
    let ok = true;
    for (let i = 0; i < pattern.length; i++) {
      if (pattern[i] !== '*' && pattern[i] !== path[i]) { ok = false; break; }
    }
    if (ok) return true;
  }
  return false;
};

const walk = (value: unknown, path: string[]): unknown => {
  if (pathMatches(path)) return SENTINEL;
  if (value === null || value === undefined) return value;
  if (typeof value === 'function') return undefined;
  if (Array.isArray(value)) {
    return value.map((v, i) => walk(v, [...path, String(i)]));
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const child = walk(v, [...path, k]);
      if (child !== undefined) out[k] = child;
    }
    return out;
  }
  return value;
};

export const redactSettings = (settings: unknown): unknown => walk(settings, []);
