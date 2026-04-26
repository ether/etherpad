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
