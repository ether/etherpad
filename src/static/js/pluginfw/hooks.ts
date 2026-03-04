// @ts-nocheck
'use strict';

const pluginDefs = require('./plugin_defs');

// Maps the name of a server-side hook to a string explaining the deprecation
// (e.g., 'use the foo hook instead').
//
// If you want to deprecate the fooBar hook, do the following:
//
//     const hooks = require('ep_etherpad-lite/static/js/pluginfw/hooks');
//     hooks.deprecationNotices.fooBar = 'use the newSpiffy hook instead';
//
exports.deprecationNotices = {};

const deprecationWarned = {};

const checkDeprecation = (hook) => {
  const notice = exports.deprecationNotices[hook.hook_name];
  if (notice == null) return;
  if (deprecationWarned[hook.hook_fn_name]) return;
  console.warn(`${hook.hook_name} hook used by the ${hook.part.plugin} plugin ` +
               `(${hook.hook_fn_name}) is deprecated: ${notice}`);
  deprecationWarned[hook.hook_fn_name] = true;
};

// Calls the node-style callback when the Promise settles. Unlike util.callbackify, this takes a
// Promise (rather than a function that returns a Promise), and it returns a Promise (rather than a
// function that returns undefined).
const attachCallback = (p, cb) => p.then(
    (val) => cb(null, val),
    // Callbacks often only check the truthiness, not the nullness, of the first parameter. To avoid
    // problems, always pass a truthy value as the first argument if the Promise is rejected.
    (err) => cb(err || new Error(err)));

// Normalizes the value provided by hook functions so that it is always an array. `undefined` (but
// not `null`!) becomes an empty array, array values are returned unmodified, and non-array values
// are wrapped in an array (so `null` becomes `[null]`).
const normalizeValue = (val) => {
  // `undefined` is treated the same as `[]`. IMPORTANT: `null` is *not* treated the same as `[]`
  // because some hooks use `null` as a special value.
  if (val === undefined) return [];
  if (Array.isArray(val)) return val;
  return [val];
};

// Flattens the array one level.
const flatten1 = (array) => array.reduce((a, b) => a.concat(b), []);

// Calls the hook function synchronously and returns the value provided by the hook function (via
// callback or return value).
//
// A synchronous hook function can provide a value in these ways:
//
//   * Call the callback, passing the desired value (which may be `undefined`) directly as the first
//     argument, then return `undefined`.
//   * For hook functions with three (or more) parameters: Directly return the desired value, which
//     must not be `undefined`. Note: If a three-parameter hook function directly returns
//     `undefined` and it has not already called the callback then it is indicating that it is not
//     yet done and will eventually call the callback. This behavior is not supported by synchronous
//     hooks.
//   * For hook functions with two (or fewer) parameters: Directly return the desired value (which
//     may be `undefined`).
//
// The callback passed to a hook function is guaranteed to return `undefined`, so it is safe for
// hook functions to do `return cb(value);`.
//
// A hook function can signal an error by throwing.
//
// A hook function settles when it provides a value (via callback or return) or throws. If a hook
// function attempts to settle again (e.g., call the callback again, or call the callback and also
// return a value) then the second attempt has no effect except either an error message is logged or
// there will be an unhandled promise rejection depending on whether the subsequent attempt is a
// duplicate (same value or error) or different, respectively.
//
// See the tests in src/tests/backend/specs/hooks.js for examples of supported and prohibited
// behaviors.
//
const callHookFnSync = (hook, context) => {
  checkDeprecation(hook);

  // This var is used to keep track of whether the hook function already settled.
  let outcome;

  // This is used to prevent recursion.
  let doubleSettleErr;

  const settle = (err, val, how) => {
    doubleSettleErr = null;
    const state = err == null ? 'resolved' : 'rejected';
    if (outcome != null) {
      // It was already settled, which indicates a bug.
      const action = err == null ? 'resolve' : 'reject';
      const msg = (`DOUBLE SETTLE BUG IN HOOK FUNCTION (plugin: ${hook.part.plugin}, ` +
                   `function name: ${hook.hook_fn_name}, hook: ${hook.hook_name}): ` +
                   `Attempt to ${action} via ${how} but it already ${outcome.state} ` +
                   `via ${outcome.how}. Ignoring this attempt to ${action}.`);
      console.error(msg);
      if (state !== outcome.state || (err == null ? val !== outcome.val : err !== outcome.err)) {
        // The second settle attempt differs from the first, which might indicate a serious bug.
        doubleSettleErr = new Error(msg);
        throw doubleSettleErr;
      }
      return;
    }
    outcome = {state, err, val, how};
    if (val && typeof val.then === 'function') {
      console.error(`PROHIBITED PROMISE BUG IN HOOK FUNCTION (plugin: ${hook.part.plugin}, ` +
                    `function name: ${hook.hook_fn_name}, hook: ${hook.hook_name}): ` +
                    'The hook function provided a "thenable" (e.g., a Promise) which is ' +
                    'prohibited because the hook expects to get the value synchronously.');
    }
  };

  // IMPORTANT: This callback must return `undefined` so that a hook function can safely do
  // `return callback(value);` for backwards compatibility.
  const callback = (ret) => {
    settle(null, ret, 'callback');
  };

  let val;
  try {
    val = hook.hook_fn(hook.hook_name, context, callback);
  } catch (err) {
    if (err === doubleSettleErr) throw err; // Avoid recursion.
    try {
      settle(err, null, 'thrown exception');
    } catch (doubleSettleErr) {
      // Schedule the throw of the double settle error on the event loop via
      // Promise.resolve().then() (which will result in an unhandled Promise rejection) so that the
      // original error is the error that is seen by the caller. Fixing the original error will
      // likely fix the double settle bug, so the original error should get priority.
      Promise.resolve().then(() => { throw doubleSettleErr; });
    }
    throw err;
  }

  // IMPORTANT: This MUST check for undefined -- not nullish -- because some hooks intentionally use
  // null as a special value.
  if (val === undefined) {
    if (outcome != null) return outcome.val; // Already settled via callback.
    if (hook.hook_fn.length >= 3) {
      console.error(`UNSETTLED FUNCTION BUG IN HOOK FUNCTION (plugin: ${hook.part.plugin}, ` +
                    `function name: ${hook.hook_fn_name}, hook: ${hook.hook_name}): ` +
                    'The hook function neither called the callback nor returned a non-undefined ' +
                    'value. This is prohibited because it will result in freezes when a future ' +
                    'version of Etherpad updates the hook to support asynchronous behavior.');
    } else {
      // The hook function is assumed to not have a callback parameter, so fall through and accept
      // `undefined` as the resolved value.
      //
      // IMPORTANT: "Rest" parameters and default parameters are not included in `Function.length`,
      // so the assumption does not hold for wrappers such as:
      //
      //     const wrapper = (...args) => real(...args);
      //
      // ECMAScript does not provide a way to determine whether a function has default or rest
      // parameters, so there is no way to be certain that a hook function with `length` < 3 will
      // not call the callback. Synchronous hook functions that call the callback even though
      // `length` < 3 will still work properly without any logged warnings or errors, but:
      //
      //   * Once the hook is upgraded to support asynchronous hook functions, calling the callback
      //     asynchronously will cause a double settle error, and the hook function will prematurely
      //     resolve to `undefined` instead of the desired value.
      //
      //   * The above "unsettled function" warning is not logged if the function fails to call the
      //     callback like it is supposed to.
      //
      // Wrapper functions can avoid problems by setting the wrapper's `length` property to match
      // the real function's `length` property:
      //
      //     Object.defineProperty(wrapper, 'length', {value: real.length});
    }
  }

  settle(null, val, 'returned value');
  return outcome.val;
};

// DEPRECATED: Use `callAllSerial()` or `aCallAll()` instead.
//
// Invokes all registered hook functions synchronously.
//
// Arguments:
//   * hookName: Name of the hook to invoke.
//   * context: Passed unmodified to the hook functions, except nullish becomes {}.
//
// Return value:
//   A flattened array of hook results. Specifically, it is equivalent to doing the following:
//     1. Collect all values returned by the hook functions into an array.
//     2. Convert each `undefined` entry into `[]`.
//     3. Flatten one level.
exports.callAll = (hookName, context) => {
  if (context == null) context = {};
  const hooks = pluginDefs.hooks[hookName] || [];
  return flatten1(hooks.map((hook) => normalizeValue(callHookFnSync(hook, context))));
};

// Calls the hook function asynchronously and returns a Promise that either resolves to the hook
// function's provided value or rejects with an error generated by the hook function.
//
// An asynchronous hook function can provide a value in these ways:
//
//   * Call the callback, passing a Promise (or thenable) that resolves to the desired value (which
//     may be `undefined`) as the first argument.
//   * Call the callback, passing the desired value (which may be `undefined`) directly as the first
//     argument.
//   * Return a Promise (or thenable) that resolves to the desired value (which may be `undefined`).
//   * For hook functions with three (or more) parameters: Directly return the desired value, which
//     must not be `undefined`. Note: If a hook function directly returns `undefined` and it has not
//     already called the callback then it is indicating that it is not yet done and will eventually
//     call the callback.
//   * For hook functions with two (or fewer) parameters: Directly return the desired value (which
//     may be `undefined`).
//
// The callback passed to a hook function is guaranteed to return `undefined`, so it is safe for
// hook functions to do `return cb(valueOrPromise);`.
//
// A hook function can signal an error in these ways:
//
//   * Throw.
//   * Return a Promise that rejects.
//   * Pass a Promise that rejects as the first argument to the provided callback.
//
// A hook function settles when it directly provides a value, when it throws, or when the Promise it
// provides settles (resolves or rejects). If a hook function attempts to settle again (e.g., call
// the callback again, or return a value and also call the callback) then the second attempt has no
// effect except either an error message is logged or an Error object is thrown depending on whether
// the subsequent attempt is a duplicate (same value or error) or different, respectively.
//
// See the tests in src/tests/backend/specs/hooks.js for examples of supported and prohibited
// behaviors.
//
const callHookFnAsync = async (hook, context) => {
  checkDeprecation(hook);
  return await new Promise((resolve, reject) => {
    // This var is used to keep track of whether the hook function already settled.
    let outcome;

    const settle = (err, val, how) => {
      const state = err == null ? 'resolved' : 'rejected';
      if (outcome != null) {
        // It was already settled, which indicates a bug.
        const action = err == null ? 'resolve' : 'reject';
        const msg = (`DOUBLE SETTLE BUG IN HOOK FUNCTION (plugin: ${hook.part.plugin}, ` +
                     `function name: ${hook.hook_fn_name}, hook: ${hook.hook_name}): ` +
                     `Attempt to ${action} via ${how} but it already ${outcome.state} ` +
                     `via ${outcome.how}. Ignoring this attempt to ${action}.`);
        console.error(msg);
        if (state !== outcome.state || (err == null ? val !== outcome.val : err !== outcome.err)) {
          // The second settle attempt differs from the first, which might indicate a serious bug.
          throw new Error(msg);
        }
        return;
      }
      outcome = {state, err, val, how};
      if (err == null) { resolve(val); } else { reject(err); }
    };

    // IMPORTANT: This callback must return `undefined` so that a hook function can safely do
    // `return callback(value);` for backwards compatibility.
    const callback = (ret) => {
      // Wrap ret in a Promise so that a hook function can do `callback(asyncFunction());`. Note: If
      // ret is a Promise (or other thenable), Promise.resolve() will flatten it into this new
      // Promise.
      Promise.resolve(ret).then(
          (val) => settle(null, val, 'callback'),
          (err) => settle(err, null, 'rejected Promise passed to callback'));
    };

    let ret;
    try {
      ret = hook.hook_fn(hook.hook_name, context, callback);
    } catch (err) {
      try {
        settle(err, null, 'thrown exception');
      } catch (doubleSettleErr) {
        // Schedule the throw of the double settle error on the event loop via
        // Promise.resolve().then() (which will result in an unhandled Promise rejection) so that
        // the original error is the error that is seen by the caller. Fixing the original error
        // will likely fix the double settle bug, so the original error should get priority.
        Promise.resolve().then(() => { throw doubleSettleErr; });
      }
      throw err;
    }

    // IMPORTANT: This MUST check for undefined -- not nullish -- because some hooks intentionally
    // use null as a special value.
    if (ret === undefined) {
      if (hook.hook_fn.length >= 3) {
        // The hook function has a callback parameter and it returned undefined, which means the
        // hook function will settle (or has already settled) via the provided callback.
        return;
      } else {
        // The hook function is assumed to not have a callback parameter, so fall through and accept
        // `undefined` as the resolved value.
        //
        // IMPORTANT: "Rest" parameters and default parameters are not included in
        // `Function.length`, so the assumption does not hold for wrappers such as:
        //
        //     const wrapper = (...args) => real(...args);
        //
        // ECMAScript does not provide a way to determine whether a function has default or rest
        // parameters, so there is no way to be certain that a hook function with `length` < 3 will
        // not call the callback. Hook functions with `length` < 3 that call the callback
        // asynchronously will cause a double settle error, and the hook function will prematurely
        // resolve to `undefined` instead of the desired value.
        //
        // Wrapper functions can avoid problems by setting the wrapper's `length` property to match
        // the real function's `length` property:
        //
        //     Object.defineProperty(wrapper, 'length', {value: real.length});
      }
    }

    // Wrap ret in a Promise so that hook functions can be async (or otherwise return a Promise).
    // Note: If ret is a Promise (or other thenable), Promise.resolve() will flatten it into this
    // new Promise.
    Promise.resolve(ret).then(
        (val) => settle(null, val, 'returned value'),
        (err) => settle(err, null, 'Promise rejection'));
  });
};

// Invokes all registered hook functions asynchronously and concurrently. This is NOT the async
// equivalent of `callAll()`: `callAll()` calls the hook functions serially (one at a time) but this
// function calls them concurrently. Use `callAllSerial()` if the hook functions must be called one
// at a time.
//
// Arguments:
//   * hookName: Name of the hook to invoke.
//   * context: Passed unmodified to the hook functions, except nullish becomes {}.
//   * cb: Deprecated. Optional node-style callback. The following:
//         const p1 = hooks.aCallAll('myHook', context, cb);
//     is equivalent to:
//         const p2 = hooks.aCallAll('myHook', context).then(
//             (val) => cb(null, val), (err) => cb(err || new Error(err)));
//
// Return value:
//   If cb is nullish, this function resolves to a flattened array of hook results. Specifically, it
//   is equivalent to doing the following:
//     1. Collect all values returned by the hook functions into an array.
//     2. Convert each `undefined` entry into `[]`.
//     3. Flatten one level.
//   If cb is non-null, this function resolves to the value returned by cb.
exports.aCallAll = async (hookName, context, cb = null) => {
  if (cb != null) return await attachCallback(exports.aCallAll(hookName, context), cb);
  if (context == null) context = {};
  const hooks = pluginDefs.hooks[hookName] || [];
  const results = await Promise.all(
      hooks.map(async (hook) => normalizeValue(await callHookFnAsync(hook, context))));
  return flatten1(results);
};

// Like `aCallAll()` except the hook functions are called one at a time instead of concurrently.
// Only use this function if the hook functions must be called one at a time, otherwise use
// `aCallAll()`.
exports.callAllSerial = async (hookName, context) => {
  if (context == null) context = {};
  const hooks = pluginDefs.hooks[hookName] || [];
  const results = [];
  for (const hook of hooks) {
    results.push(normalizeValue(await callHookFnAsync(hook, context)));
  }
  return flatten1(results);
};

// DEPRECATED: Use `aCallFirst()` instead.
//
// Like `aCallFirst()`, but synchronous. Hook functions must provide their values synchronously.
exports.callFirst = (hookName, context) => {
  if (context == null) context = {};
  const predicate = (val) => val.length;
  const hooks = pluginDefs.hooks[hookName] || [];
  for (const hook of hooks) {
    const val = normalizeValue(callHookFnSync(hook, context));
    if (predicate(val)) return val;
  }
  return [];
};

// Invokes the registered hook functions one at a time until one provides a value that meets a
// customizable condition.
//
// Arguments:
//   * hookName: Name of the hook to invoke.
//   * context: Passed unmodified to the hook functions, except nullish becomes {}.
//   * cb: Deprecated callback. The following:
//         const p1 = hooks.aCallFirst('myHook', context, cb);
//     is equivalent to:
//         const p2 = hooks.aCallFirst('myHook', context).then(
//             (val) => cb(null, val), (err) => cb(err || new Error(err)));
//   * predicate: Optional predicate function that returns true if the hook function provided a
//     value that satisfies a desired condition. If nullish, the predicate defaults to a non-empty
//     array check. The predicate is invoked each time a hook function returns. It takes one
//     argument: the normalized value provided by the hook function. If the predicate returns
//     truthy, iteration over the hook functions stops (no more hook functions will be called).
//
// Return value:
//   If cb is nullish, resolves to an array that is either the normalized value that satisfied the
//   predicate or empty if the predicate was never satisfied. If cb is non-nullish, resolves to the
//   value returned from cb().
exports.aCallFirst = async (hookName, context, cb = null, predicate = null) => {
  if (cb != null) {
    return await attachCallback(exports.aCallFirst(hookName, context, null, predicate), cb);
  }
  if (context == null) context = {};
  if (predicate == null) predicate = (val) => val.length;
  const hooks = pluginDefs.hooks[hookName] || [];
  for (const hook of hooks) {
    const val = normalizeValue(await callHookFnAsync(hook, context));
    if (predicate(val)) return val;
  }
  return [];
};

exports.exportedForTestingOnly = {
  callHookFnAsync,
  callHookFnSync,
  deprecationWarned,
};
