'use strict';

import {deserializeOps, pack, unpack} from './Changeset';
import AttributeMap from './AttributeMap';
import AttributePool from './AttributePool';
import {SmartOpAssembler} from './SmartOpAssembler';

/**
 * Ensure every insert (`+`) op in a wire changeset carries an `author` attribute.
 *
 * Why this exists: the local author id (`clientVars.userId`) only becomes available
 * once the CLIENT_VARS socket message arrives. Under load (notably Firefox with
 * plugins) the editor can become editable and the user can type *before* that
 * message lands, so the editor tags the insert with an empty author. An empty
 * author canonicalizes to "no author", producing an unattributed insert that the
 * server's pad-corruption guard rejects — dropping the whole USER_CHANGES and
 * silently losing the typed text's authorship (the clear_authorship_color flake).
 *
 * This runs in collab_client, which only exists after CLIENT_VARS has arrived, so
 * the author id passed here is always populated. Stamping any author-less insert
 * just before the changeset is sent guarantees the server never sees an
 * unattributed insert, independent of editor-init timing.
 *
 * @param changeset - The wire changeset string from prepareUserChangeset().
 * @param apoolJsonable - The jsonable wire attribute pool that accompanies it.
 * @param authorId - The local author id (collab_client's userId). If falsy, the
 *     inputs are returned unchanged (nothing better to stamp with).
 * @returns The (possibly) rewritten changeset + jsonable pool. Returns the inputs
 *     unchanged when no insert needed an author, so the common path is a no-op.
 */
export const stampAuthorOnInserts = (
  changeset: string,
  apoolJsonable: any,
  authorId: string,
): {changeset: string, apool: any} => {
  if (!authorId) return {changeset, apool: apoolJsonable};
  const pool = (new AttributePool()).fromJsonable(apoolJsonable);
  const unpacked = unpack(changeset);
  const assem = new SmartOpAssembler();
  let modified = false;
  for (const op of deserializeOps(unpacked.ops)) {
    if (op.opcode === '+') {
      const attribs = AttributeMap.fromString(op.attribs, pool);
      if (!attribs.get('author')) {
        attribs.set('author', authorId);
        op.attribs = attribs.toString();
        modified = true;
      }
    }
    assem.append(op);
  }
  if (!modified) return {changeset, apool: apoolJsonable};
  assem.endDocument();
  return {
    changeset: pack(unpacked.oldLen, unpacked.newLen, assem.toString(), unpacked.charBank),
    apool: pool.toJsonable(),
  };
};
