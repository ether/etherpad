import {describe, it, expect, beforeEach, vi} from 'vitest';
import settings from '../../../../node/utils/Settings';
import {check} from '../../../../node/utils/UpdateCheck';

describe('UpdateCheck opt-out', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('check() does not call fetch when privacy.updateCheck is false', async () => {
    settings.privacy.updateCheck = false;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{}', {status: 200})
    );
    check();
    // Allow any internal microtasks to settle.
    await new Promise((r) => setImmediate(r));
    expect(fetchSpy).not.toHaveBeenCalled();
    settings.privacy.updateCheck = true;
  });

  it('check() calls fetch when privacy.updateCheck is true', async () => {
    settings.privacy.updateCheck = true;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({latestVersion: '99.0.0'}), {status: 200})
    );
    check();
    await new Promise((r) => setImmediate(r));
    expect(fetchSpy).toHaveBeenCalled();
  });
});
