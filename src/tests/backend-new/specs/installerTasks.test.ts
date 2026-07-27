'use strict';

import {describe, it, expect, vi} from 'vitest';
import {InstallerTaskQueue} from '../../../static/js/pluginfw/installerTasks';

describe('InstallerTaskQueue', () => {
  it('fires onFinished after a single successful task', () => {
    const onFinished = vi.fn();
    const q = new InstallerTaskQueue(onFinished);
    const cb = vi.fn();
    const wrapped = q.wrap(cb);

    wrapped(null);

    expect(cb).toHaveBeenCalledWith(null);
    expect(onFinished).toHaveBeenCalledTimes(1);
  });

  it('does NOT fire onFinished when the only task in the batch failed', () => {
    // Regression: before this fix, a failed install(EngineIncompatibleError)
    // would still trigger restartServer via onAllTasksFinished, kicking every
    // connected pad off the server for no benefit. Reported by Qodo on
    // PR #7771.
    const onFinished = vi.fn();
    const q = new InstallerTaskQueue(onFinished);
    const wrapped = q.wrap(vi.fn());

    wrapped(new Error('plugin requires a newer version of Etherpad'));

    expect(onFinished).not.toHaveBeenCalled();
  });

  it('fires onFinished when at least one task in a mixed batch succeeded', () => {
    const onFinished = vi.fn();
    const q = new InstallerTaskQueue(onFinished);
    const ok = q.wrap(vi.fn());
    const bad = q.wrap(vi.fn());

    bad(new Error('boom'));
    expect(onFinished).not.toHaveBeenCalled();
    ok(null);

    expect(onFinished).toHaveBeenCalledTimes(1);
  });

  it('does NOT fire onFinished when every task in a multi-task batch failed', () => {
    const onFinished = vi.fn();
    const q = new InstallerTaskQueue(onFinished);
    const a = q.wrap(vi.fn());
    const b = q.wrap(vi.fn());

    a(new Error('one'));
    b(new Error('two'));

    expect(onFinished).not.toHaveBeenCalled();
  });

  it('resets the success flag between batches', () => {
    const onFinished = vi.fn();
    const q = new InstallerTaskQueue(onFinished);

    const ok = q.wrap(vi.fn());
    ok(null);
    expect(onFinished).toHaveBeenCalledTimes(1);

    const bad = q.wrap(vi.fn());
    bad(new Error('next batch all failed'));
    expect(onFinished).toHaveBeenCalledTimes(1);
  });

  it('tolerates a null callback', () => {
    const onFinished = vi.fn();
    const q = new InstallerTaskQueue(onFinished);
    const wrapped = q.wrap(null);

    expect(() => wrapped(null)).not.toThrow();
    expect(onFinished).toHaveBeenCalledTimes(1);
  });

  it('only fires onFinished once all wrapped tasks have completed', () => {
    const onFinished = vi.fn();
    const q = new InstallerTaskQueue(onFinished);
    const a = q.wrap(vi.fn());
    const b = q.wrap(vi.fn());

    a(null);
    expect(onFinished).not.toHaveBeenCalled();
    b(null);

    expect(onFinished).toHaveBeenCalledTimes(1);
  });
});
