# Hooks

A hook function is registered with a hook via the plugin's `ep.json` file. See
the Plugins section for details. A hook may have many registered functions from
different plugins.

Some hooks call their registered functions one at a time until one of them
returns a value. Others always call all of their registered functions and
combine the results (if applicable).

## Registered hook functions

Note: The documentation in this section applies to every hook unless the
hook-specific documentation says otherwise.

### Arguments

Hook functions are called with three arguments:

1. `hookName` - The name of the hook being invoked.
2. `context` - An object with some relevant information about the context of the
   call. See the hook-specific documentation for details.
3. `cb` - For asynchronous operations this callback can be called to signal
   completion and optionally provide a return value. The callback takes a single
   argument, the meaning of which depends on the hook (see the "Return values"
   section for general information that applies to most hooks). This callback
   always returns `undefined`.

### Expected behavior

The presence of a callback parameter suggests that every hook function can run
asynchronously. While that is the eventual goal, there are some legacy hooks
that expect their hook functions to provide a value synchronously. For such
hooks, the hook functions must do one of the following:

* Call the callback with a non-Promise value (`undefined` is acceptable) and
  return `undefined`, in that order.
* Return a non-Promise value other than `undefined` (`null` is acceptable) and
  never call the callback. Note that `async` functions *always* return a
  Promise, so they must never be used for synchronous hooks.
* Only have two parameters (`hookName` and `context`) and return any non-Promise
  value (`undefined` is acceptable).

For hooks that permit asynchronous behavior, the hook functions must do one or
more of the following:

* Return `undefined` and call the callback, in either order.
* Return something other than `undefined` (`null` is acceptable) and never call
  the callback. Note that `async` functions *always* return a Promise, so they
  must never call the callback.
* Only have two parameters (`hookName` and `context`).

Note that the acceptable behaviors for asynchronous hook functions is a superset
of the acceptable behaviors for synchronous hook functions.

WARNING: The number of parameters is determined by examining
[Function.length](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Function/length),
which does not count [default
parameters](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Functions/Default_parameters)
or ["rest"
parameters](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Functions/rest_parameters).
To avoid problems, do not use default or rest parameters when defining hook
functions.

### Return values

A hook function can provide a value to Etherpad in one of the following ways:

* Pass the desired value as the first argument to the callback.
* Return the desired value directly. The value must not be `undefined` unless
  the hook function only has two parameters. (Hook functions with three
  parameters that want to provide `undefined` should instead use the callback.)
* For hooks that permit asynchronous behavior, return a Promise that resolves to
  the desired value.
* For hooks that permit asynchronous behavior, pass a Promise that resolves to
  the desired value as the first argument to the callback.

Examples:

```javascript
exports.exampleOne = (hookName, context, callback) => {
  return 'valueOne';
};

exports.exampleTwo = (hookName, context, callback) => {
  callback('valueTwo');
  return;
};

// ONLY FOR HOOKS THAT PERMIT ASYNCHRONOUS BEHAVIOR
exports.exampleThree = (hookName, context, callback) => {
  return new Promise('valueThree');
};

// ONLY FOR HOOKS THAT PERMIT ASYNCHRONOUS BEHAVIOR
exports.exampleFour = (hookName, context, callback) => {
  callback(new Promise('valueFour'));
  return;
};

// ONLY FOR HOOKS THAT PERMIT ASYNCHRONOUS BEHAVIOR
exports.exampleFive = async (hookName, context) => {
  // Note that this function is async, so it actually returns a Promise that
  // is resolved to 'valueFive'.
  return 'valueFive';
};
```

Etherpad collects the values provided by the hook functions into an array,
filters out all `undefined` values, then flattens the array one level.
Flattening one level makes it possible for a hook function to behave as if it
were multiple separate hook functions.

For example: Suppose a hook has eight registered functions that return the
following values: `1`, `[2]`, `['3a', '3b']` `[[4]]`, `undefined`,
`[undefined]`, `[]`, and `null`. The value returned to the caller of the hook is
`[1, 2, '3a', '3b', [4], undefined, null]`.
