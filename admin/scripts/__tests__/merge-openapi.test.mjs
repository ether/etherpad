import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {mergeOpenAPI} from '../merge-openapi.mjs';

const minimal = (overrides = {}) => ({
  openapi: '3.0.2',
  info: {title: 'X', version: '0.0.0'},
  paths: {},
  components: {schemas: {}, securitySchemes: {}},
  ...overrides,
});

test('unions paths from both docs', () => {
  const pub = minimal({paths: {'/createGroup': {post: {operationId: 'createGroup'}}}});
  const adm = minimal({paths: {'/admin-auth/': {post: {operationId: 'verifyAdminAccess'}}}});
  const out = mergeOpenAPI(pub, adm);
  assert.deepEqual(Object.keys(out.paths).sort(), ['/admin-auth/', '/createGroup']);
});

test('throws on path collision', () => {
  const pub = minimal({paths: {'/x': {get: {}}}});
  const adm = minimal({paths: {'/x': {post: {}}}});
  assert.throws(() => mergeOpenAPI(pub, adm), /path collision/i);
});

test('unions components.schemas', () => {
  const pub = minimal({components: {schemas: {A: {}}, securitySchemes: {}}});
  const adm = minimal({components: {schemas: {B: {}}, securitySchemes: {}}});
  const out = mergeOpenAPI(pub, adm);
  assert.deepEqual(Object.keys(out.components.schemas).sort(), ['A', 'B']);
});

test('throws on schema name collision', () => {
  const pub = minimal({components: {schemas: {Dup: {}}, securitySchemes: {}}});
  const adm = minimal({components: {schemas: {Dup: {}}, securitySchemes: {}}});
  assert.throws(() => mergeOpenAPI(pub, adm), /schema collision/i);
});

test('unions securitySchemes', () => {
  const pub = minimal({components: {schemas: {}, securitySchemes: {apiKey: {}}}});
  const adm = minimal({components: {schemas: {}, securitySchemes: {basicAuth: {}}}});
  const out = mergeOpenAPI(pub, adm);
  assert.deepEqual(
    Object.keys(out.components.securitySchemes).sort(),
    ['apiKey', 'basicAuth'],
  );
});

test('preserves public root security; admin per-operation security survives', () => {
  const pub = minimal({security: [{apiKey: []}]});
  const adm = minimal({
    paths: {
      '/admin-auth/': {
        post: {
          security: [{basicAuth: []}, {}],
        },
      },
    },
  });
  const out = mergeOpenAPI(pub, adm);
  assert.deepEqual(out.security, [{apiKey: []}]);
  assert.deepEqual(
    out.paths['/admin-auth/'].post.security,
    [{basicAuth: []}, {}],
  );
});

test('public info wins on conflict', () => {
  const pub = minimal({info: {title: 'Public', version: '1.0'}});
  const adm = minimal({info: {title: 'Admin', version: '2.0'}});
  const out = mergeOpenAPI(pub, adm);
  assert.equal(out.info.title, 'Public');
  assert.equal(out.info.version, '1.0');
});
