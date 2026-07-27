/**
 * Regression tests for OIDCAdapter (MemoryAdapter).
 *
 * Covers the four flows that were silently broken before the fix:
 *   1. upsert → revokeByGrantId actually clears tokens
 *   2. upsert → findByUserCode returns the payload
 *   3. destroy clears the userCode mapping
 *   4. consume on a missing id does not throw
 */

import {describe, it} from 'mocha';
import {strict as assert} from 'assert';
import MemoryAdapter from '../../../node/security/OIDCAdapter';

describe('OIDCAdapter', () => {
  let adapter: InstanceType<typeof MemoryAdapter>;

  beforeEach(() => {
    adapter = new MemoryAdapter('Session');
  });

  it('revokeByGrantId clears all tokens sharing the grant', async () => {
    const grantId = 'grant-1';

    await adapter.upsert('tok-a', {grantId, jti: 'tok-a'} as any, 60);
    await adapter.upsert('tok-b', {grantId, jti: 'tok-b'} as any, 60);

    await adapter.revokeByGrantId(grantId);

    assert.equal(await adapter.find('tok-a'), undefined);
    assert.equal(await adapter.find('tok-b'), undefined);
  });

  it('findByUserCode returns the payload after upsert', async () => {
    const userCode = 'USER-CODE-123';

    await adapter.upsert('dc-tok', {userCode, jti: 'dc-tok'} as any, 60);

    const result = await adapter.findByUserCode(userCode);
    assert.ok(result, 'expected payload to be defined');
    assert.equal((result as any).jti, 'dc-tok');
  });

  it('destroy removes the userCode mapping', async () => {
    const userCode = 'USER-CODE-456';

    await adapter.upsert('dc-tok-2', {userCode, jti: 'dc-tok-2'} as any, 60);
    await adapter.destroy('dc-tok-2');

    const result = await adapter.findByUserCode(userCode);
    assert.equal(result, undefined);
  });

  it('consume on a missing id does not throw', async () => {
    await assert.doesNotReject(() => adapter.consume('non-existent-id'));
  });
});
