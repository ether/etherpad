import {describe, it, expect} from 'vitest';
import settings from '../../../node/utils/Settings';

describe('room broadcast NEW_CHANGES defaults', () => {
  it('roomBroadcastNewChanges defaults to false', () => {
    expect(settings.roomBroadcastNewChanges).toBe(false);
  });
});
