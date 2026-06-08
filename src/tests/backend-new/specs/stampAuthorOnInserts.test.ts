'use strict';

import {describe, it, expect} from 'vitest';
import {stampAuthorOnInserts} from '../../../static/js/stampAuthorOnInserts';
import {checkRep, deserializeOps, unpack} from '../../../static/js/Changeset';
import AttributeMap from '../../../static/js/AttributeMap';
import AttributePool from '../../../static/js/AttributePool';

const AUTHOR = 'a.test1234567890';
const EMPTY_POOL = () => (new AttributePool()).toJsonable();

// Read the author attribute off the first '+' op of a (changeset, jsonable pool).
const firstInsertAuthor = (changeset: string, apoolJsonable: any): string | undefined => {
  const pool = (new AttributePool()).fromJsonable(apoolJsonable);
  for (const op of deserializeOps(unpack(changeset).ops)) {
    if (op.opcode === '+') return AttributeMap.fromString(op.attribs, pool).get('author');
  }
  return undefined;
};

describe('stampAuthorOnInserts', () => {
  it('stamps the author onto an unattributed insert (the flake changeset)', () => {
    // `Z:1>5+5$Hello` — insert "Hello" with NO author, exactly what the editor
    // emits during the early-typing race and what the server rejects.
    const input = 'Z:1>5+5$Hello';
    const {changeset, apool} = stampAuthorOnInserts(input, EMPTY_POOL(), AUTHOR);
    // The insert now carries the author...
    expect(firstInsertAuthor(changeset, apool)).toBe(AUTHOR);
    // ...the result is a valid canonical changeset...
    expect(() => checkRep(changeset)).not.toThrow();
    // ...and the text is preserved.
    expect(unpack(changeset).charBank).toBe('Hello');
    // It actually changed (was unattributed before).
    expect(changeset).not.toBe(input);
  });

  it('leaves an already-attributed insert unchanged', () => {
    // Build `Z:1>5*0+5$Hello` with author already in the pool.
    const pool = new AttributePool();
    const n = pool.putAttrib(['author', AUTHOR]); // index 0
    const attributed = `Z:1>5*${n}+5$Hello`;
    const jsonable = pool.toJsonable();
    const {changeset, apool} = stampAuthorOnInserts(attributed, jsonable, AUTHOR);
    expect(changeset).toBe(attributed); // unchanged (no-op path)
    expect(firstInsertAuthor(changeset, apool)).toBe(AUTHOR);
  });

  it('does not invent an author when authorId is empty', () => {
    const input = 'Z:1>5+5$Hello';
    const {changeset} = stampAuthorOnInserts(input, EMPTY_POOL(), '');
    expect(changeset).toBe(input); // nothing to stamp with → unchanged
  });

  it('does not touch keep/remove-only changesets', () => {
    // `Z:6<1=5-1$` — keep 5, remove 1; no insert ops.
    const input = 'Z:6<1=5-1$x';
    const {changeset} = stampAuthorOnInserts(input, EMPTY_POOL(), AUTHOR);
    expect(changeset).toBe(input);
  });

  it('preserves a non-author attribute already on the insert while adding author', () => {
    // Insert with a bold attribute but no author.
    const pool = new AttributePool();
    const b = pool.putAttrib(['bold', 'true']); // index 0
    const input = `Z:1>5*${b}+5$Hello`;
    const {changeset, apool} = stampAuthorOnInserts(input, pool.toJsonable(), AUTHOR);
    const outPool = (new AttributePool()).fromJsonable(apool);
    let amap: AttributeMap | null = null;
    for (const op of deserializeOps(unpack(changeset).ops)) {
      if (op.opcode === '+') { amap = AttributeMap.fromString(op.attribs, outPool); break; }
    }
    expect(amap!.get('author')).toBe(AUTHOR);
    expect(amap!.get('bold')).toBe('true');
    expect(() => checkRep(changeset)).not.toThrow();
  });
});
