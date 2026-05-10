/**
 * Safety helpers for any release-tag string Etherpad's updater hands to git.
 *
 * The release tag originates from GitHub's `releases/latest` API (`tag_name`)
 * and is then persisted into `var/update-state.json`. A tag that starts with
 * `-` would be parsed by git as an option flag rather than a positional ref —
 * `git checkout -fast-forward` and similar tricks could bypass signature
 * verification or change checkout semantics. A tag with shell metacharacters
 * is less of an issue under `child_process.spawn` (no shell), but we reject
 * those too because git's own ref-name rules forbid them and a malformed tag
 * has nowhere reasonable to be honoured anyway.
 *
 * Rules (a subset of git's check-ref-format spec — strict on purpose):
 *   - Non-empty.
 *   - Length <= 200.
 *   - May not start with `-` (option injection) or `.` (git rejects).
 *   - May not contain whitespace, NUL, or any of: ~ ^ : ? * [ \\
 *   - May not contain `..` (git's own rule).
 *
 * Callers should also use the `refs/tags/<tag>` form when invoking git so
 * that even an unforeseen edge-case can't be parsed as an option, and pass
 * `--` as an end-of-options marker on commands that accept it.
 */

const FORBIDDEN_CHARS = /[\s\x00~^:?*\[\\]/;

export const isValidTag = (tag: unknown): tag is string => {
  if (typeof tag !== 'string') return false;
  if (tag.length === 0 || tag.length > 200) return false;
  if (tag.startsWith('-') || tag.startsWith('.')) return false;
  if (FORBIDDEN_CHARS.test(tag)) return false;
  if (tag.includes('..')) return false;
  return true;
};

/** Throwing form for hot paths where invalid input is a programmer/data error. */
export const assertValidTag = (tag: unknown): string => {
  if (!isValidTag(tag)) throw new Error(`unsafe release tag: ${JSON.stringify(tag)}`);
  return tag as string;
};

/** Wrap a validated tag in the `refs/tags/<tag>` form for git invocations. */
export const refsTagsForm = (tag: string): string => `refs/tags/${tag}`;
