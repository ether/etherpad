'use strict';
/**
 * Helpers to manipulate promises (like async but for promises).
 */

// Returns a Promise that resolves to the first resolved value from `promises` that satisfies
// `predicate`. Resolves to `undefined` if none of the Promises satisfy `predicate`, or if
// `promises` is empty. If `predicate` is nullish, the truthiness of the resolved value is used as
// the predicate.
export const firstSatisfies = <T>(promises: Promise<T>[], predicate: null|Function) => {
  if (predicate == null) {
    predicate = (x: any) => x;
  }

  // Transform each original Promise into a Promise that never resolves if the original resolved
  // value does not satisfy `predicate`. These transformed Promises will be passed to Promise.race,
  // yielding the first resolved value that satisfies `predicate`.
  const newPromises = promises.map((p) =>
      new Promise((resolve, reject) => p.then((v) => predicate!(v) && resolve(v), reject)));

  // If `promises` is an empty array or if none of them resolve to a value that satisfies
  // `predicate`, then `Promise.race(newPromises)` will never resolve. To handle that, add another
  // Promise that resolves to `undefined` after all of the original Promises resolve.
  //
  // Note: If all of the original Promises simultaneously resolve to a value that satisfies
  // `predicate` (perhaps they were already resolved when this function was called), then this
  // Promise will resolve too, and with a value of `undefined`. There is no concern that this
  // Promise will win the race and thus cause an erroneous `undefined` result. This is because
  // a resolved Promise's `.then()` function is scheduled for execution -- not executed right away
  // -- and ES guarantees in-order execution of the enqueued invocations. Each of the above
  // transformed Promises has a `.then()` chain of length one, while the Promise added here has a
  // `.then()` chain of length two or more (at least one `.then()` that is internal to
  // `Promise.all()`, plus the `.then()` function added here). By the time the `.then()` function
  // added here executes, all of the above transformed Promises will have already resolved and one
  // will have been chosen as the winner.
  newPromises.push(Promise.all(promises).then(() => {}));

  return Promise.race(newPromises);
};

// Calls `promiseCreator(i)` a total number of `total` times, where `i` is 0 through `total - 1` (in
// order). The `concurrency` argument specifies the maximum number of Promises returned by
// `promiseCreator` that are allowed to be active (unresolved) simultaneously. (In other words: If
// `total` is greater than `concurrency`, then `concurrency` Promises will be created right away,
// and each remaining Promise will be created once one of the earlier Promises resolves.) This async
// function resolves once all `total` Promises have resolved.
export const timesLimit = async (total: number, concurrency: number, promiseCreator: Function) => {
  if (total > 0 && concurrency <= 0) throw new RangeError('concurrency must be positive');
  let next = 0;
  const addAnother = () => promiseCreator(next++).finally(() => {
    if (next < total) return addAnother();
  });
  const promises = [];
  for (let i = 0; i < concurrency && i < total; i++) {
    promises.push(addAnother());
  }
  await Promise.all(promises);
};

/**
 * An ordinary Promise except the `resolve` and `reject` executor functions are exposed as
 * properties.
 */
export class Gate<T> extends Promise<T> {
  // Coax `.then()` into returning an ordinary Promise, not a Gate. See
  // https://stackoverflow.com/a/65669070 for the rationale.
  static get [Symbol.species]() { return Promise; }

  constructor() {
    // `this` is assigned when `super()` returns, not when it is called, so it is not acceptable to
    // do the following because it will throw a ReferenceError when it dereferences `this`:
    //     super((resolve, reject) => Object.assign(this, {resolve, reject}));
    let props: any;
    super((resolve, reject) => props = {resolve, reject});
    Object.assign(this, props);
  }
}
