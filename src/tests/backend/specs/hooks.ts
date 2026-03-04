'use strict';

import {strict as assert} from 'assert';
const hooks = require('../../../static/js/pluginfw/hooks');
const plugins = require('../../../static/js/pluginfw/plugin_defs');
import sinon from 'sinon';
import {MapArrayType} from "../../../node/types/MapType";


interface ExtendedConsole extends Console {
  warn: {
    (message?: any, ...optionalParams: any[]): void;
    callCount: number;
    getCall: (i: number) => {args: any[]};
  };
    error: {
        (message?: any, ...optionalParams: any[]): void;
        callCount: number;
        getCall: (i: number) => {args: any[]};
        callsFake: (fn: Function) => void;
        getCalls: () => {args: any[]}[];
    };
}

declare var console: ExtendedConsole;

describe(__filename, function () {



  const hookName = 'testHook';
  const hookFnName = 'testPluginFileName:testHookFunctionName';
  let testHooks; // Convenience shorthand for plugins.hooks[hookName].
  let hook: any; // Convenience shorthand for plugins.hooks[hookName][0].

  beforeEach(async function () {
    // Make sure these are not already set so that we don't accidentally step on someone else's
    // toes:
    assert(plugins.hooks[hookName] == null);
    assert(hooks.deprecationNotices[hookName] == null);
    assert(hooks.exportedForTestingOnly.deprecationWarned[hookFnName] == null);

    // Many of the tests only need a single registered hook function. Set that up here to reduce
    // boilerplate.
    hook = makeHook();
    plugins.hooks[hookName] = [hook];
    testHooks = plugins.hooks[hookName];
  });

  afterEach(async function () {
    sinon.restore();
    delete plugins.hooks[hookName];
    delete hooks.deprecationNotices[hookName];
    delete hooks.exportedForTestingOnly.deprecationWarned[hookFnName];
  });

  const makeHook = (ret?:any) => ({
    hook_name: hookName,
    // Many tests will likely want to change this. Unfortunately, we can't use a convenience
    // wrapper like `(...args) => hookFn(..args)` because the hooks look at Function.length and
    // change behavior depending on the number of parameters.
    hook_fn: (hn:Function, ctx:any, cb:Function) => cb(ret),
    hook_fn_name: hookFnName,
    part: {plugin: 'testPluginName'},
  });

  // Hook functions that should work for both synchronous and asynchronous hooks.
  const supportedSyncHookFunctions = [
    {
      name: 'return non-Promise value, with callback parameter',
      fn: (hn:Function, ctx:any, cb:Function) => 'val',
      want: 'val',
      syncOk: true,
    },
    {
      name: 'return non-Promise value, without callback parameter',
      fn: (hn:Function, ctx:any) => 'val',
      want: 'val',
      syncOk: true,
    },
    {
      name: 'return undefined, without callback parameter',
      fn: (hn:Function, ctx:any) => {},
      want: undefined,
      syncOk: true,
    },
    {
      name: 'pass non-Promise value to callback',
      fn: (hn:Function, ctx:any, cb:Function) => { cb('val'); },
      want: 'val',
      syncOk: true,
    },
    {
      name: 'pass undefined to callback',
      fn: (hn:Function, ctx:any, cb:Function) => { cb(); },
      want: undefined,
      syncOk: true,
    },
    {
      name: 'return the value returned from the callback',
      fn: (hn:Function, ctx:any, cb:Function) => cb('val'),
      want: 'val',
      syncOk: true,
    },
    {
      name: 'throw',
      fn: (hn:Function, ctx:any, cb:Function) => { throw new Error('test exception'); },
      wantErr: 'test exception',
      syncOk: true,
    },
  ];

  describe('callHookFnSync', function () {
    const callHookFnSync = hooks.exportedForTestingOnly.callHookFnSync; // Convenience shorthand.

    describe('basic behavior', function () {
      it('passes hook name', async function () {
        hook.hook_fn = (hn: string) => { assert.equal(hn, hookName); };
        callHookFnSync(hook);
      });

      it('passes context', async function () {
        for (const val of ['value', null, undefined]) {
          hook.hook_fn = (hn: string, ctx:string) => { assert.equal(ctx, val); };
          callHookFnSync(hook, val);
        }
      });

      it('returns the value provided to the callback', async function () {
        for (const val of ['value', null, undefined]) {
          hook.hook_fn = (hn:Function, ctx:any, cb:Function) => { cb(ctx); };
          assert.equal(callHookFnSync(hook, val), val);
        }
      });

      it('returns the value returned by the hook function', async function () {
        for (const val of ['value', null, undefined]) {
          // Must not have the cb parameter otherwise returning undefined will error.
          hook.hook_fn = (hn: string, ctx: any) => ctx;
          assert.equal(callHookFnSync(hook, val), val);
        }
      });

      it('does not catch exceptions', async function () {
        hook.hook_fn = () => { throw new Error('test exception'); };
        assert.throws(() => callHookFnSync(hook), {message: 'test exception'});
      });

      it('callback returns undefined', async function () {
        hook.hook_fn = (hn:Function, ctx:any, cb:Function) => { assert.equal(cb('foo'), undefined); };
        callHookFnSync(hook);
      });

      it('checks for deprecation', async function () {
        sinon.stub(console, 'warn');
        hooks.deprecationNotices[hookName] = 'test deprecation';
        callHookFnSync(hook);
        assert.equal(hooks.exportedForTestingOnly.deprecationWarned[hookFnName], true);
        // @ts-ignore
        assert.equal(console.warn.callCount, 1);
        // @ts-ignore
        assert.match(console.warn.getCall(0).args[0], /test deprecation/);
      });
    });

    describe('supported hook function styles', function () {
      for (const tc of supportedSyncHookFunctions) {
        it(tc.name, async function () {
          sinon.stub(console, 'warn');
          sinon.stub(console, 'error');
          hook.hook_fn = tc.fn;
          const call = () => callHookFnSync(hook);
          if (tc.wantErr) {
            assert.throws(call, {message: tc.wantErr});
          } else {
            assert.equal(call(), tc.want);
          }
          assert.equal(console.warn.callCount, 0);
          assert.equal(console.error.callCount, 0);
        });
      }
    });

    describe('bad hook function behavior (other than double settle)', function () {
      const promise1 = Promise.resolve('val1');
      const promise2 = Promise.resolve('val2');

      const testCases = [
        {
          name: 'never settles -> buggy hook detected',
          // Note that returning undefined without calling the callback is permitted if the function
          // has 2 or fewer parameters, so this test function must have 3 parameters.
          fn: (hn:Function, ctx:any, cb:Function) => {},
          wantVal: undefined,
          wantError: /UNSETTLED FUNCTION BUG/,
        },
        {
          name: 'returns a Promise -> buggy hook detected',
          fn: () => promise1,
          wantVal: promise1,
          wantError: /PROHIBITED PROMISE BUG/,
        },
        {
          name: 'passes a Promise to cb -> buggy hook detected',
          fn: (hn:Function, ctx:any, cb:Function) => cb(promise2),
          wantVal: promise2,
          wantError: /PROHIBITED PROMISE BUG/,
        },
      ];

      for (const tc of testCases) {
        it(tc.name, async function () {
          sinon.stub(console, 'error');
          hook.hook_fn = tc.fn;
          assert.equal(callHookFnSync(hook), tc.wantVal);
          assert.equal(console.error.callCount, tc.wantError ? 1 : 0);
          if (tc.wantError) assert.match(console.error.getCall(0).args[0], tc.wantError);
        });
      }
    });

    // Test various ways a hook might attempt to settle twice. (Examples: call the callback a second
    // time, or call the callback and then return a value.)
    describe('bad hook function behavior (double settle)', function () {
      beforeEach(async function () {
        sinon.stub(console, 'error');
      });

      // Each item in this array codifies a way to settle a synchronous hook function. Each of the
      // test cases below combines two of these behaviors in a single hook function and confirms
      // that callHookFnSync both (1) returns the result of the first settle attempt, and
      // (2) detects the second settle attempt.
      const behaviors = [
        {
          name: 'throw',
          fn: (cb: Function, err:any, val: string) => { throw err; },
          rejects: true,
        },
        {
          name: 'return value',
          fn: (cb: Function, err:any, val: string) => val,
        },
        {
          name: 'immediately call cb(value)',
          fn: (cb: Function, err:any, val: string) => cb(val),
        },
        {
          name: 'defer call to cb(value)',
          fn: (cb: Function, err:any, val: string) => { process.nextTick(cb, val); },
          async: true,
        },
      ];

      for (const step1 of behaviors) {
        // There can't be a second step if the first step is to return or throw.
        if (step1.name.startsWith('return ') || step1.name === 'throw') continue;
        for (const step2 of behaviors) {
          // If step1 and step2 are both async then there would be three settle attempts (first an
          // erroneous unsettled return, then async step 1, then async step 2). Handling triple
          // settle would complicate the tests, and it is sufficient to test only double settles.
          if (step1.async && step2.async) continue;

          it(`${step1.name} then ${step2.name} (diff. outcomes) -> log+throw`, async function () {
            hook.hook_fn = (hn:Function, ctx:any, cb:Function) => {
              step1.fn(cb, new Error(ctx.ret1), ctx.ret1);
              return step2.fn(cb, new Error(ctx.ret2), ctx.ret2);
            };

            // Temporarily remove unhandled error listeners so that the errors we expect to see
            // don't trigger a test failure (or terminate node).
            const events = ['uncaughtException', 'unhandledRejection'];
            const listenerBackups:MapArrayType<any> = {};
            for (const event of events) {
              listenerBackups[event] = process.rawListeners(event);
              process.removeAllListeners(event);
            }

            // We should see an asynchronous error (either an unhandled Promise rejection or an
            // uncaught exception) if and only if one of the two steps was asynchronous or there was
            // a throw (in which case the double settle is deferred so that the caller sees the
            // original error).
            const wantAsyncErr = step1.async || step2.async || step2.rejects;
            let tempListener:Function;
            let asyncErr:Error|undefined;
            try {
              const seenErrPromise = new Promise<void>((resolve) => {
                tempListener = (err:any) => {
                  assert.equal(asyncErr, undefined);
                  asyncErr = err;
                  resolve();
                };
                if (!wantAsyncErr) resolve();
              });
              // @ts-ignore
              events.forEach((event) => process.on(event, tempListener));
              const call = () => callHookFnSync(hook, {ret1: 'val1', ret2: 'val2'});
              if (step2.rejects) {
                assert.throws(call, {message: 'val2'});
              } else if (!step1.async && !step2.async) {
                assert.throws(call, {message: /DOUBLE SETTLE BUG/});
              } else {
                assert.equal(call(), step1.async ? 'val2' : 'val1');
              }
              await seenErrPromise;
            } finally {
              // Restore the original listeners.
              for (const event of events) {
                // @ts-ignore
                process.off(event, tempListener);
                for (const listener of listenerBackups[event]) {
                  process.on(event, listener);
                }
              }
            }
            assert.equal(console.error.callCount, 1);
            assert.match(console.error.getCall(0).args[0], /DOUBLE SETTLE BUG/);
            if (wantAsyncErr) {
              assert(asyncErr instanceof Error);
              assert.match(asyncErr.message, /DOUBLE SETTLE BUG/);
            }
          });

          // This next test is the same as the above test, except the second settle attempt is for
          // the same outcome. The two outcomes can't be the same if one step throws and the other
          // doesn't, so skip those cases.
          if (step1.rejects !== step2.rejects) continue;

          it(`${step1.name} then ${step2.name} (same outcome) -> only log`, async function () {
            const err = new Error('val');
            hook.hook_fn = (hn:Function, ctx:any, cb:Function) => {
              step1.fn(cb, err, 'val');
              return step2.fn(cb, err, 'val');
            };

            const errorLogged = new Promise((resolve) => console.error.callsFake(resolve));
            const call = () => callHookFnSync(hook);
            if (step2.rejects) {
              assert.throws(call, {message: 'val'});
            } else {
              assert.equal(call(), 'val');
            }
            await errorLogged;
            assert.equal(console.error.callCount, 1);
            assert.match(console.error.getCall(0).args[0], /DOUBLE SETTLE BUG/);
          });
        }
      }
    });
  });

  describe('hooks.callAll', function () {
    describe('basic behavior', function () {
      it('calls all in order', async function () {
        testHooks.length = 0;
        testHooks.push(makeHook(1), makeHook(2), makeHook(3));
        assert.deepEqual(hooks.callAll(hookName), [1, 2, 3]);
      });

      it('passes hook name', async function () {
        hook.hook_fn = (hn:string) => { assert.equal(hn, hookName); };
        hooks.callAll(hookName);
      });

      it('undefined context -> {}', async function () {
        hook.hook_fn = (hn: string, ctx: any) => { assert.deepEqual(ctx, {}); };
        hooks.callAll(hookName);
      });

      it('null context -> {}', async function () {
        hook.hook_fn = (hn: string, ctx: any) => { assert.deepEqual(ctx, {}); };
        hooks.callAll(hookName, null);
      });

      it('context unmodified', async function () {
        const wantContext = {};
        hook.hook_fn = (hn: string, ctx: any) => { assert.equal(ctx, wantContext); };
        hooks.callAll(hookName, wantContext);
      });
    });

    describe('result processing', function () {
      it('no registered hooks (undefined) -> []', async function () {
        delete plugins.hooks.testHook;
        assert.deepEqual(hooks.callAll(hookName), []);
      });

      it('no registered hooks (empty list) -> []', async function () {
        testHooks.length = 0;
        assert.deepEqual(hooks.callAll(hookName), []);
      });

      it('flattens one level', async function () {
        testHooks.length = 0;
        testHooks.push(makeHook(1), makeHook([2]), makeHook([[3]]));
        assert.deepEqual(hooks.callAll(hookName), [1, 2, [3]]);
      });

      it('filters out undefined', async function () {
        testHooks.length = 0;
        testHooks.push(makeHook(), makeHook([2]), makeHook([[3]]));
        assert.deepEqual(hooks.callAll(hookName), [2, [3]]);
      });

      it('preserves null', async function () {
        testHooks.length = 0;
        testHooks.push(makeHook(null), makeHook([2]), makeHook([[3]]));
        assert.deepEqual(hooks.callAll(hookName), [null, 2, [3]]);
      });

      it('all undefined -> []', async function () {
        testHooks.length = 0;
        testHooks.push(makeHook(), makeHook());
        assert.deepEqual(hooks.callAll(hookName), []);
      });
    });
  });

  describe('hooks.callFirst', function () {
    it('no registered hooks (undefined) -> []', async function () {
      delete plugins.hooks.testHook;
      assert.deepEqual(hooks.callFirst(hookName), []);
    });

    it('no registered hooks (empty list) -> []', async function () {
      testHooks.length = 0;
      assert.deepEqual(hooks.callFirst(hookName), []);
    });

    it('passes hook name => {}', async function () {
      hook.hook_fn = (hn: string) => { assert.equal(hn, hookName); };
      hooks.callFirst(hookName);
    });

    it('undefined context => {}', async function () {
      hook.hook_fn = (hn: string, ctx: any) => { assert.deepEqual(ctx, {}); };
      hooks.callFirst(hookName);
    });

    it('null context => {}', async function () {
      hook.hook_fn = (hn: string, ctx: any) => { assert.deepEqual(ctx, {}); };
      hooks.callFirst(hookName, null);
    });

    it('context unmodified', async function () {
      const wantContext = {};
      hook.hook_fn = (hn: string, ctx: any) => { assert.equal(ctx, wantContext); };
      hooks.callFirst(hookName, wantContext);
    });

    it('predicate never satisfied -> calls all in order', async function () {
      const gotCalls:MapArrayType<any> = [];
      testHooks.length = 0;
      for (let i = 0; i < 3; i++) {
        const hook = makeHook();
        hook.hook_fn = () => { gotCalls.push(i); };
        testHooks.push(hook);
      }
      assert.deepEqual(hooks.callFirst(hookName), []);
      assert.deepEqual(gotCalls, [0, 1, 2]);
    });

    it('stops when predicate is satisfied', async function () {
      testHooks.length = 0;
      testHooks.push(makeHook(), makeHook('val1'), makeHook('val2'));
      assert.deepEqual(hooks.callFirst(hookName), ['val1']);
    });

    it('skips values that do not satisfy predicate (undefined)', async function () {
      testHooks.length = 0;
      testHooks.push(makeHook(), makeHook('val1'));
      assert.deepEqual(hooks.callFirst(hookName), ['val1']);
    });

    it('skips values that do not satisfy predicate (empty list)', async function () {
      testHooks.length = 0;
      testHooks.push(makeHook([]), makeHook('val1'));
      assert.deepEqual(hooks.callFirst(hookName), ['val1']);
    });

    it('null satisifes the predicate', async function () {
      testHooks.length = 0;
      testHooks.push(makeHook(null), makeHook('val1'));
      assert.deepEqual(hooks.callFirst(hookName), [null]);
    });

    it('non-empty arrays are returned unmodified', async function () {
      const want = ['val1'];
      testHooks.length = 0;
      testHooks.push(makeHook(want), makeHook(['val2']));
      assert.equal(hooks.callFirst(hookName), want); // Note: *NOT* deepEqual!
    });

    it('value can be passed via callback', async function () {
      const want = {};
      hook.hook_fn = (hn:Function, ctx:any, cb:Function) => { cb(want); };
      const got = hooks.callFirst(hookName);
      assert.deepEqual(got, [want]);
      assert.equal(got[0], want); // Note: *NOT* deepEqual!
    });
  });

  describe('callHookFnAsync', function () {
    const callHookFnAsync = hooks.exportedForTestingOnly.callHookFnAsync; // Convenience shorthand.

    describe('basic behavior', function () {
      it('passes hook name', async function () {
        hook.hook_fn = (hn:string) => { assert.equal(hn, hookName); };
        await callHookFnAsync(hook);
      });

      it('passes context', async function () {
        for (const val of ['value', null, undefined]) {
          hook.hook_fn = (hn: string, ctx: any) => { assert.equal(ctx, val); };
          await callHookFnAsync(hook, val);
        }
      });

      it('returns the value provided to the callback', async function () {
        for (const val of ['value', null, undefined]) {
          hook.hook_fn = (hn:Function, ctx:any, cb:Function) => { cb(ctx); };
          assert.equal(await callHookFnAsync(hook, val), val);
          assert.equal(await callHookFnAsync(hook, Promise.resolve(val)), val);
        }
      });

      it('returns the value returned by the hook function', async function () {
        for (const val of ['value', null, undefined]) {
          // Must not have the cb parameter otherwise returning undefined will never resolve.
          hook.hook_fn = (hn: string, ctx: any) => ctx;
          assert.equal(await callHookFnAsync(hook, val), val);
          assert.equal(await callHookFnAsync(hook, Promise.resolve(val)), val);
        }
      });

      it('rejects if it throws an exception', async function () {
        hook.hook_fn = () => { throw new Error('test exception'); };
        await assert.rejects(callHookFnAsync(hook), {message: 'test exception'});
      });

      it('rejects if rejected Promise passed to callback', async function () {
        hook.hook_fn = (hn:Function, ctx:any, cb:Function) => cb(Promise.reject(new Error('test exception')));
        await assert.rejects(callHookFnAsync(hook), {message: 'test exception'});
      });

      it('rejects if rejected Promise returned', async function () {
        hook.hook_fn = (hn:Function, ctx:any, cb:Function) => Promise.reject(new Error('test exception'));
        await assert.rejects(callHookFnAsync(hook), {message: 'test exception'});
      });

      it('callback returns undefined', async function () {
        hook.hook_fn = (hn:Function, ctx:any, cb:Function) => { assert.equal(cb('foo'), undefined); };
        await callHookFnAsync(hook);
      });

      it('checks for deprecation', async function () {
        sinon.stub(console, 'warn');
        hooks.deprecationNotices[hookName] = 'test deprecation';
        await callHookFnAsync(hook);
        assert.equal(hooks.exportedForTestingOnly.deprecationWarned[hookFnName], true);
        assert.equal(console.warn.callCount, 1);
        assert.match(console.warn.getCall(0).args[0], /test deprecation/);
      });
    });

    describe('supported hook function styles', function () {
      // @ts-ignore
      const supportedHookFunctions = supportedSyncHookFunctions.concat([
        {
          name: 'legacy async cb',
          fn: (hn:Function, ctx:any, cb:Function) => { process.nextTick(cb, 'val'); },
          want: 'val',
        },
        // Already resolved Promises:
        {
          name: 'return resolved Promise, with callback parameter',
          fn: (hn:Function, ctx:any, cb:Function) => Promise.resolve('val'),
          want: 'val',
        },
        {
          name: 'return resolved Promise, without callback parameter',
          fn: (hn: string, ctx: any) => Promise.resolve('val'),
          want: 'val',
        },
        {
          name: 'pass resolved Promise to callback',
          fn: (hn:Function, ctx:any, cb:Function) => { cb(Promise.resolve('val')); },
          want: 'val',
        },
        // Not yet resolved Promises:
        {
          name: 'return unresolved Promise, with callback parameter',
          fn: (hn:Function, ctx:any, cb:Function) => new Promise((resolve) => process.nextTick(resolve, 'val')),
          want: 'val',
        },
        {
          name: 'return unresolved Promise, without callback parameter',
          fn: (hn: string, ctx: any) => new Promise((resolve) => process.nextTick(resolve, 'val')),
          want: 'val',
        },
        {
          name: 'pass unresolved Promise to callback',
          fn: (hn:Function, ctx:any, cb:Function) => { cb(new Promise((resolve) => process.nextTick(resolve, 'val'))); },
          want: 'val',
        },
        // Already rejected Promises:
        {
          name: 'return rejected Promise, with callback parameter',
          fn: (hn:Function, ctx:any, cb:Function) => Promise.reject(new Error('test rejection')),
          wantErr: 'test rejection',
        },
        {
          name: 'return rejected Promise, without callback parameter',
          fn: (hn: string, ctx: any) => Promise.reject(new Error('test rejection')),
          wantErr: 'test rejection',
        },
        {
          name: 'pass rejected Promise to callback',
          fn: (hn:Function, ctx:any, cb:Function) => { cb(Promise.reject(new Error('test rejection'))); },
          wantErr: 'test rejection',
        },
        // Not yet rejected Promises:
        {
          name: 'return unrejected Promise, with callback parameter',
          fn: (hn:Function, ctx:any, cb:Function) => new Promise((resolve, reject) => {
            process.nextTick(reject, new Error('test rejection'));
          }),
          wantErr: 'test rejection',
        },
        {
          name: 'return unrejected Promise, without callback parameter',
          fn: (hn: string, ctx: any) => new Promise((resolve, reject) => {
            process.nextTick(reject, new Error('test rejection'));
          }),
          wantErr: 'test rejection',
        },
        {
          name: 'pass unrejected Promise to callback',
          fn: (hn:Function, ctx:any, cb:Function) => {
            cb(new Promise((resolve, reject) => {
              process.nextTick(reject, new Error('test rejection'));
            }));
          },
          wantErr: 'test rejection',
        },
      ]);

      for (const tc of supportedSyncHookFunctions.concat(supportedHookFunctions)) {
        it(tc.name, async function () {
          sinon.stub(console, 'warn');
          sinon.stub(console, 'error');
          hook.hook_fn = tc.fn;
          const p = callHookFnAsync(hook);
          if (tc.wantErr) {
            await assert.rejects(p, {message: tc.wantErr});
          } else {
            assert.equal(await p, tc.want);
          }
          assert.equal(console.warn.callCount, 0);
          assert.equal(console.error.callCount, 0);
        });
      }
    });

    // Test various ways a hook might attempt to settle twice. (Examples: call the callback a second
    // time, or call the callback and then return a value.)
    describe('bad hook function behavior (double settle)', function () {
      beforeEach(async function () {
        sinon.stub(console, 'error');
      });

      // Each item in this array codifies a way to settle an asynchronous hook function. Each of the
      // test cases below combines two of these behaviors in a single hook function and confirms
      // that callHookFnAsync both (1) resolves to the result of the first settle attempt, and (2)
      // detects the second settle attempt.
      //
      // The 'when' property specifies the relative time that two behaviors will cause the hook
      // function to settle:
      //   * If behavior1.when <= behavior2.when and behavior1 is called before behavior2 then
      //     behavior1 will settle the hook function before behavior2.
      //   * Otherwise, behavior2 will settle the hook function before behavior1.
      const behaviors = [
        {
          name: 'throw',
          fn: (cb: Function, err:any, val: string) => { throw err; },
          rejects: true,
          when: 0,
        },
        {
          name: 'return value',
          fn: (cb: Function, err:any, val: string) => val,
          // This behavior has a later relative settle time vs. the 'throw' behavior because 'throw'
          // immediately settles the hook function, whereas the 'return value' case is settled by a
          // .then() function attached to a Promise. EcmaScript guarantees that a .then() function
          // attached to a Promise is enqueued on the event loop (not executed immediately) when the
          // Promise settles.
          when: 1,
        },
        {
          name: 'immediately call cb(value)',
          fn: (cb: Function, err:any, val: string) => cb(val),
          // This behavior has the same relative time as the 'return value' case because it too is
          // settled by a .then() function attached to a Promise.
          when: 1,
        },
        {
          name: 'return resolvedPromise',
          fn: (cb: Function, err:any, val: string) => Promise.resolve(val),
          // This behavior has the same relative time as the 'return value' case because the return
          // value is wrapped in a Promise via Promise.resolve(). The EcmaScript standard guarantees
          // that Promise.resolve(Promise.resolve(value)) is equivalent to Promise.resolve(value),
          // so returning an already resolved Promise vs. returning a non-Promise value are
          // equivalent.
          when: 1,
        },
        {
          name: 'immediately call cb(resolvedPromise)',
          fn: (cb: Function, err:any, val: string) => cb(Promise.resolve(val)),
          when: 1,
        },
        {
          name: 'return rejectedPromise',
          fn: (cb: Function, err:any, val: string) => Promise.reject(err),
          rejects: true,
          when: 1,
        },
        {
          name: 'immediately call cb(rejectedPromise)',
          fn: (cb: Function, err:any, val: string) => cb(Promise.reject(err)),
          rejects: true,
          when: 1,
        },
        {
          name: 'return unresolvedPromise',
          fn: (cb: Function, err:any, val: string) => new Promise((resolve) => process.nextTick(resolve, val)),
          when: 2,
        },
        {
          name: 'immediately call cb(unresolvedPromise)',
          fn: (cb: Function, err:any, val: string) => cb(new Promise((resolve) => process.nextTick(resolve, val))),
          when: 2,
        },
        {
          name: 'return unrejectedPromise',
          fn: (cb: Function, err:any, val: string) => new Promise((resolve, reject) => process.nextTick(reject, err)),
          rejects: true,
          when: 2,
        },
        {
          name: 'immediately call cb(unrejectedPromise)',
          fn: (cb: Function, err:any, val: string) => cb(new Promise((resolve, reject) => process.nextTick(reject, err))),
          rejects: true,
          when: 2,
        },
        {
          name: 'defer call to cb(value)',
          fn: (cb: Function, err:any, val: string) => { process.nextTick(cb, val); },
          when: 2,
        },
        {
          name: 'defer call to cb(resolvedPromise)',
          fn: (cb: Function, err:any, val: string) => { process.nextTick(cb, Promise.resolve(val)); },
          when: 2,
        },
        {
          name: 'defer call to cb(rejectedPromise)',
          fn: (cb: Function, err:any, val: string) => { process.nextTick(cb, Promise.reject(err)); },
          rejects: true,
          when: 2,
        },
        {
          name: 'defer call to cb(unresolvedPromise)',
          fn: (cb: Function, err:any, val: string) => {
            process.nextTick(() => {
              cb(new Promise((resolve) => process.nextTick(resolve, val)));
            });
          },
          when: 3,
        },
        {
          name: 'defer call cb(unrejectedPromise)',
          fn: (cb: Function, err:any, val: string) => {
            process.nextTick(() => {
              cb(new Promise((resolve, reject) => process.nextTick(reject, err)));
            });
          },
          rejects: true,
          when: 3,
        },
      ];

      for (const step1 of behaviors) {
        // There can't be a second step if the first step is to return or throw.
        if (step1.name.startsWith('return ') || step1.name === 'throw') continue;
        for (const step2 of behaviors) {
          it(`${step1.name} then ${step2.name} (diff. outcomes) -> log+throw`, async function () {
            hook.hook_fn = (hn:Function, ctx:any, cb:Function) => {
              step1.fn(cb, new Error(ctx.ret1), ctx.ret1);
              return step2.fn(cb, new Error(ctx.ret2), ctx.ret2);
            };

            // Temporarily remove unhandled Promise rejection listeners so that the unhandled
            // rejections we expect to see don't trigger a test failure (or terminate node).
            const event = 'unhandledRejection';
            const listenersBackup = process.rawListeners(event);
            process.removeAllListeners(event);

            let tempListener;
            let asyncErr: Error;
            try {
              const seenErrPromise = new Promise<void>((resolve) => {
                tempListener = (err:any) => {
                  assert.equal(asyncErr, undefined);
                  asyncErr = err;
                  resolve();
                };
              });
              process.on(event, tempListener!);
              const step1Wins = step1.when <= step2.when;
              const winningStep = step1Wins ? step1 : step2;
              const winningVal = step1Wins ? 'val1' : 'val2';
              const p = callHookFnAsync(hook, {ret1: 'val1', ret2: 'val2'});
              if (winningStep.rejects) {
                await assert.rejects(p, {message: winningVal});
              } else {
                assert.equal(await p, winningVal);
              }
              await seenErrPromise;
            } finally {
              // Restore the original listeners.
              process.off(event, tempListener!);
              for (const listener of listenersBackup) {
                process.on(event, listener as any);
              }
            }
            assert.equal(console.error.callCount, 1,
                `Got errors:\n${
                  console.error.getCalls().map((call) => call.args[0]).join('\n')}`);
            assert.match(console.error.getCall(0).args[0], /DOUBLE SETTLE BUG/);
            // @ts-ignore
            assert(asyncErr instanceof Error);
            assert.match(asyncErr.message, /DOUBLE SETTLE BUG/);
          });

          // This next test is the same as the above test, except the second settle attempt is for
          // the same outcome. The two outcomes can't be the same if one step rejects and the other
          // doesn't, so skip those cases.
          if (step1.rejects !== step2.rejects) continue;

          it(`${step1.name} then ${step2.name} (same outcome) -> only log`, async function () {
            const err = new Error('val');
            hook.hook_fn = (hn:Function, ctx:any, cb:Function) => {
              step1.fn(cb, err, 'val');
              return step2.fn(cb, err, 'val');
            };
            const winningStep = (step1.when <= step2.when) ? step1 : step2;
            const errorLogged = new Promise((resolve) => console.error.callsFake(resolve));
            const p = callHookFnAsync(hook);
            if (winningStep.rejects) {
              await assert.rejects(p, {message: 'val'});
            } else {
              assert.equal(await p, 'val');
            }
            await errorLogged;
            assert.equal(console.error.callCount, 1);
            assert.match(console.error.getCall(0).args[0], /DOUBLE SETTLE BUG/);
          });
        }
      }
    });
  });

  describe('hooks.aCallAll', function () {
    describe('basic behavior', function () {
      it('calls all asynchronously, returns values in order', async function () {
        testHooks.length = 0; // Delete the boilerplate hook -- this test doesn't use it.
        let nextIndex = 0;
        const hookPromises: {
            promise?: Promise<number>,
            resolve?: Function,
        } []
         = [];
        const hookStarted: boolean[] = [];
        const hookFinished :boolean[]= [];
        const makeHook = () => {
          const i = nextIndex++;
          const entry:{
            promise?: Promise<number>,
            resolve?: Function,
          } = {};
          hookStarted[i] = false;
          hookFinished[i] = false;
          hookPromises[i] = entry;
          entry.promise = new Promise((resolve) => {
            entry.resolve = () => {
              hookFinished[i] = true;
              resolve(i);
            };
          });
          return {hook_fn: () => {
            hookStarted[i] = true;
            return entry.promise;
          }};
        };
        testHooks.push(makeHook(), makeHook());
        const p = hooks.aCallAll(hookName);
        assert.deepEqual(hookStarted, [true, true]);
        assert.deepEqual(hookFinished, [false, false]);
        hookPromises[1].resolve!();
        await hookPromises[1].promise;
        assert.deepEqual(hookFinished, [false, true]);
        hookPromises[0].resolve!();
        assert.deepEqual(await p, [0, 1]);
      });

      it('passes hook name', async function () {
        hook.hook_fn = async (hn:string) => { assert.equal(hn, hookName); };
        await hooks.aCallAll(hookName);
      });

      it('undefined context -> {}', async function () {
        hook.hook_fn = async (hn: string, ctx: any) => { assert.deepEqual(ctx, {}); };
        await hooks.aCallAll(hookName);
      });

      it('null context -> {}', async function () {
        hook.hook_fn = async (hn: string, ctx: any) => { assert.deepEqual(ctx, {}); };
        await hooks.aCallAll(hookName, null);
      });

      it('context unmodified', async function () {
        const wantContext = {};
        hook.hook_fn = async (hn: string, ctx: any) => { assert.equal(ctx, wantContext); };
        await hooks.aCallAll(hookName, wantContext);
      });
    });

    describe('aCallAll callback', function () {
      it('exception in callback rejects', async function () {
        const p = hooks.aCallAll(hookName, {}, () => { throw new Error('test exception'); });
        await assert.rejects(p, {message: 'test exception'});
      });

      it('propagates error on exception', async function () {
        hook.hook_fn = () => { throw new Error('test exception'); };
        await hooks.aCallAll(hookName, {}, (err:any) => {
          assert(err instanceof Error);
          assert.equal(err.message, 'test exception');
        });
      });

      it('propagages null error on success', async function () {
        await hooks.aCallAll(hookName, {}, (err:any) => {
          assert(err == null, `got non-null error: ${err}`);
        });
      });

      it('propagages results on success', async function () {
        hook.hook_fn = () => 'val';
        await hooks.aCallAll(hookName, {}, (err:any, results:any) => {
          assert.deepEqual(results, ['val']);
        });
      });

      it('returns callback return value', async function () {
        assert.equal(await hooks.aCallAll(hookName, {}, () => 'val'), 'val');
      });
    });

    describe('result processing', function () {
      it('no registered hooks (undefined) -> []', async function () {
        delete plugins.hooks[hookName];
        assert.deepEqual(await hooks.aCallAll(hookName), []);
      });

      it('no registered hooks (empty list) -> []', async function () {
        testHooks.length = 0;
        assert.deepEqual(await hooks.aCallAll(hookName), []);
      });

      it('flattens one level', async function () {
        testHooks.length = 0;
        testHooks.push(makeHook(1), makeHook([2]), makeHook([[3]]));
        assert.deepEqual(await hooks.aCallAll(hookName), [1, 2, [3]]);
      });

      it('filters out undefined', async function () {
        testHooks.length = 0;
        testHooks.push(makeHook(), makeHook([2]), makeHook([[3]]), makeHook(Promise.resolve()));
        assert.deepEqual(await hooks.aCallAll(hookName), [2, [3]]);
      });

      it('preserves null', async function () {
        testHooks.length = 0;
        testHooks.push(makeHook(null), makeHook([2]), makeHook(Promise.resolve(null)));
        assert.deepEqual(await hooks.aCallAll(hookName), [null, 2, null]);
      });

      it('all undefined -> []', async function () {
        testHooks.length = 0;
        testHooks.push(makeHook(), makeHook(Promise.resolve()));
        assert.deepEqual(await hooks.aCallAll(hookName), []);
      });
    });
  });

  describe('hooks.callAllSerial', function () {
    describe('basic behavior', function () {
      it('calls all asynchronously, serially, in order', async function () {
        const gotCalls:number[] = [];
        testHooks.length = 0;
        for (let i = 0; i < 3; i++) {
          const hook = makeHook();
          hook.hook_fn = async () => {
            gotCalls.push(i);
            // Check gotCalls asynchronously to ensure that the next hook function does not start
            // executing before this hook function has resolved.
            return await new Promise((resolve) => {
              setImmediate(() => {
                assert.deepEqual(gotCalls, [...Array(i + 1).keys()]);
                resolve(i);
              });
            });
          };
          testHooks.push(hook);
        }
        assert.deepEqual(await hooks.callAllSerial(hookName), [0, 1, 2]);
        assert.deepEqual(gotCalls, [0, 1, 2]);
      });

      it('passes hook name', async function () {
        hook.hook_fn = async (hn:string) => { assert.equal(hn, hookName); };
        await hooks.callAllSerial(hookName);
      });

      it('undefined context -> {}', async function () {
        hook.hook_fn = async (hn: string, ctx: any) => { assert.deepEqual(ctx, {}); };
        await hooks.callAllSerial(hookName);
      });

      it('null context -> {}', async function () {
        hook.hook_fn = async (hn: string, ctx: any) => { assert.deepEqual(ctx, {}); };
        await hooks.callAllSerial(hookName, null);
      });

      it('context unmodified', async function () {
        const wantContext = {};
        hook.hook_fn = async (hn: string, ctx: any) => { assert.equal(ctx, wantContext); };
        await hooks.callAllSerial(hookName, wantContext);
      });
    });

    describe('result processing', function () {
      it('no registered hooks (undefined) -> []', async function () {
        delete plugins.hooks[hookName];
        assert.deepEqual(await hooks.callAllSerial(hookName), []);
      });

      it('no registered hooks (empty list) -> []', async function () {
        testHooks.length = 0;
        assert.deepEqual(await hooks.callAllSerial(hookName), []);
      });

      it('flattens one level', async function () {
        testHooks.length = 0;
        testHooks.push(makeHook(1), makeHook([2]), makeHook([[3]]));
        assert.deepEqual(await hooks.callAllSerial(hookName), [1, 2, [3]]);
      });

      it('filters out undefined', async function () {
        testHooks.length = 0;
        testHooks.push(makeHook(), makeHook([2]), makeHook([[3]]), makeHook(Promise.resolve()));
        assert.deepEqual(await hooks.callAllSerial(hookName), [2, [3]]);
      });

      it('preserves null', async function () {
        testHooks.length = 0;
        testHooks.push(makeHook(null), makeHook([2]), makeHook(Promise.resolve(null)));
        assert.deepEqual(await hooks.callAllSerial(hookName), [null, 2, null]);
      });

      it('all undefined -> []', async function () {
        testHooks.length = 0;
        testHooks.push(makeHook(), makeHook(Promise.resolve()));
        assert.deepEqual(await hooks.callAllSerial(hookName), []);
      });
    });
  });

  describe('hooks.aCallFirst', function () {
    it('no registered hooks (undefined) -> []', async function () {
      delete plugins.hooks.testHook;
      assert.deepEqual(await hooks.aCallFirst(hookName), []);
    });

    it('no registered hooks (empty list) -> []', async function () {
      testHooks.length = 0;
      assert.deepEqual(await hooks.aCallFirst(hookName), []);
    });

    it('passes hook name => {}', async function () {
      hook.hook_fn = (hn:string) => { assert.equal(hn, hookName); };
      await hooks.aCallFirst(hookName);
    });

    it('undefined context => {}', async function () {
      hook.hook_fn = (hn: string, ctx: any) => { assert.deepEqual(ctx, {}); };
      await hooks.aCallFirst(hookName);
    });

    it('null context => {}', async function () {
      hook.hook_fn = (hn: string, ctx: any) => { assert.deepEqual(ctx, {}); };
      await hooks.aCallFirst(hookName, null);
    });

    it('context unmodified', async function () {
      const wantContext = {};
      hook.hook_fn = (hn: string, ctx: any) => { assert.equal(ctx, wantContext); };
      await hooks.aCallFirst(hookName, wantContext);
    });

    it('default predicate: predicate never satisfied -> calls all in order', async function () {
      const gotCalls:number[] = [];
      testHooks.length = 0;
      for (let i = 0; i < 3; i++) {
        const hook = makeHook();
        hook.hook_fn = () => { gotCalls.push(i); };
        testHooks.push(hook);
      }
      assert.deepEqual(await hooks.aCallFirst(hookName), []);
      assert.deepEqual(gotCalls, [0, 1, 2]);
    });

    it('calls hook functions serially', async function () {
      const gotCalls: number[] = [];
      testHooks.length = 0;
      for (let i = 0; i < 3; i++) {
        const hook = makeHook();
        hook.hook_fn = async () => {
          gotCalls.push(i);
          // Check gotCalls asynchronously to ensure that the next hook function does not start
          // executing before this hook function has resolved.
          return await new Promise<void>((resolve) => {
            setImmediate(() => {
              assert.deepEqual(gotCalls, [...Array(i + 1).keys()]);
              resolve();
            });
          });
        };
        testHooks.push(hook);
      }
      assert.deepEqual(await hooks.aCallFirst(hookName), []);
      assert.deepEqual(gotCalls, [0, 1, 2]);
    });

    it('default predicate: stops when satisfied', async function () {
      testHooks.length = 0;
      testHooks.push(makeHook(), makeHook('val1'), makeHook('val2'));
      assert.deepEqual(await hooks.aCallFirst(hookName), ['val1']);
    });

    it('default predicate: skips values that do not satisfy (undefined)', async function () {
      testHooks.length = 0;
      testHooks.push(makeHook(), makeHook('val1'));
      assert.deepEqual(await hooks.aCallFirst(hookName), ['val1']);
    });

    it('default predicate: skips values that do not satisfy (empty list)', async function () {
      testHooks.length = 0;
      testHooks.push(makeHook([]), makeHook('val1'));
      assert.deepEqual(await hooks.aCallFirst(hookName), ['val1']);
    });

    it('default predicate: null satisifes', async function () {
      testHooks.length = 0;
      testHooks.push(makeHook(null), makeHook('val1'));
      assert.deepEqual(await hooks.aCallFirst(hookName), [null]);
    });

    it('custom predicate: called for each hook function', async function () {
      testHooks.length = 0;
      testHooks.push(makeHook(0), makeHook(1), makeHook(2));
      let got = 0;
      await hooks.aCallFirst(hookName, null, null, (val:string) => { ++got; return false; });
      assert.equal(got, 3);
    });

    it('custom predicate: boolean false/true continues/stops iteration', async function () {
      testHooks.length = 0;
      testHooks.push(makeHook(1), makeHook(2), makeHook(3));
      let nCall = 0;
      const predicate = (val: number[]) => {
        assert.deepEqual(val, [++nCall]);
        return nCall === 2;
      };
      assert.deepEqual(await hooks.aCallFirst(hookName, null, null, predicate), [2]);
      assert.equal(nCall, 2);
    });

    it('custom predicate: non-boolean falsy/truthy continues/stops iteration', async function () {
      testHooks.length = 0;
      testHooks.push(makeHook(1), makeHook(2), makeHook(3));
      let nCall = 0;
      const predicate = (val: number[]) => {
        assert.deepEqual(val, [++nCall]);
        return nCall === 2 ? {} : null;
      };
      assert.deepEqual(await hooks.aCallFirst(hookName, null, null, predicate), [2]);
      assert.equal(nCall, 2);
    });

    it('custom predicate: array value passed unmodified to predicate', async function () {
      const want = [0];
      hook.hook_fn = () => want;
      const predicate = (got: []) => { assert.equal(got, want); }; // Note: *NOT* deepEqual!
      await hooks.aCallFirst(hookName, null, null, predicate);
    });

    it('custom predicate: normalized value passed to predicate (undefined)', async function () {
      const predicate = (got: []) => { assert.deepEqual(got, []); };
      await hooks.aCallFirst(hookName, null, null, predicate);
    });

    it('custom predicate: normalized value passed to predicate (null)', async function () {
      hook.hook_fn = () => null;
      const predicate = (got: []) => { assert.deepEqual(got, [null]); };
      await hooks.aCallFirst(hookName, null, null, predicate);
    });

    it('non-empty arrays are returned unmodified', async function () {
      const want = ['val1'];
      testHooks.length = 0;
      testHooks.push(makeHook(want), makeHook(['val2']));
      assert.equal(await hooks.aCallFirst(hookName), want); // Note: *NOT* deepEqual!
    });

    it('value can be passed via callback', async function () {
      const want = {};
      hook.hook_fn = (hn:Function, ctx:any, cb:Function) => { cb(want); };
      const got = await hooks.aCallFirst(hookName);
      assert.deepEqual(got, [want]);
      assert.equal(got[0], want); // Note: *NOT* deepEqual!
    });
  });
});
