import {afterAll, beforeAll, describe, it} from 'vitest';

process.env.NODE_ENV = 'production';
process.env.AUTHENTICATION_METHOD = 'sso';

Object.assign(globalThis, {
  after: afterAll,
  before: beforeAll,
  context: describe,
  specify: it,
  xdescribe: describe.skip,
  xit: it.skip,
});

// Mocha-compatible globals are aliased above at runtime. Declare them so
// TypeScript recognizes them in test files.
declare global {
  // eslint-disable-next-line no-var
  var before: typeof beforeAll;
  // eslint-disable-next-line no-var
  var after: typeof afterAll;
  // eslint-disable-next-line no-var
  var context: typeof describe;
  // eslint-disable-next-line no-var
  var specify: typeof it;
  // eslint-disable-next-line no-var
  var xdescribe: typeof describe.skip;
  // eslint-disable-next-line no-var
  var xit: typeof it.skip;
}
