'use strict';

/**
 * API specs
 *
 * Tests for generic overarching HTTP API related features not related to any
 * specific part of the data model or domain. For example: tests for versioning
 * and openapi definitions.
 */

const common = require('../../common');
const validateOpenAPI = require('openapi-schema-validation').validate;
import settings from '../../../../node/utils/Settings';

let agent: any;
let apiVersion = 1;

const makeid = () => {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

  for (let i = 0; i < 5; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
};

const testPadId = makeid();

const endPoint = (point:string) => `/api/${apiVersion}/${point}`;

describe(__filename, function () {
  before(async function () { agent = await common.init(); });

  it('can obtain API version', async function () {
    await agent.get('/api/')
        .expect(200)
        .expect((res:any) => {
          apiVersion = res.body.currentVersion;
          if (!res.body.currentVersion) throw new Error('No version set in API');
          return;
        });
  });

  it('can obtain valid openapi definition document', async function () {
    this.timeout(15000);
    await agent.get('/api/openapi.json')
        .expect(200)
        .expect((res:any) => {
          const {valid, errors} = validateOpenAPI(res.body, 3);
          if (!valid) {
            const prettyErrors = JSON.stringify(errors, null, 2);
            throw new Error(`Document is not valid OpenAPI. ${errors.length} ` +
                            `validation errors:\n${prettyErrors}`);
          }
        });
  });

  describe('security schemes with authenticationMethod=apikey', function () {
    let originalAuthMethod: string;

    before(function () {
      originalAuthMethod = settings.authenticationMethod;
      settings.authenticationMethod = 'apikey';
    });

    after(function () {
      settings.authenticationMethod = originalAuthMethod;
    });

    it('/api-docs.json documents apikey query param (primary name)', async function () {
      const res = await agent.get('/api-docs.json').expect(200);
      const schemes = res.body.components.securitySchemes;
      const apiKeyQuery = Object.values(schemes).find(
          (s: any) => s.type === 'apiKey' && s.in === 'query' && s.name === 'apikey');
      if (!apiKeyQuery) {
        throw new Error(`Expected apiKey query param 'apikey' in securitySchemes: ` +
                        `${JSON.stringify(schemes)}`);
      }
    });

    it('/api-docs.json documents api_key query param alias', async function () {
      const res = await agent.get('/api-docs.json').expect(200);
      const schemes = res.body.components.securitySchemes;
      const apiKeyQueryAlias = Object.values(schemes).find(
          (s: any) => s.type === 'apiKey' && s.in === 'query' && s.name === 'api_key');
      if (!apiKeyQueryAlias) {
        throw new Error(`Expected apiKey query param 'api_key' in securitySchemes: ` +
                        `${JSON.stringify(schemes)}`);
      }
    });

    it('/api-docs.json documents apikey header', async function () {
      const res = await agent.get('/api-docs.json').expect(200);
      const schemes = res.body.components.securitySchemes;
      const apiKeyHeader = Object.values(schemes).find(
          (s: any) => s.type === 'apiKey' && s.in === 'header' && s.name === 'apikey');
      if (!apiKeyHeader) {
        throw new Error(`Expected apiKey header 'apikey' in securitySchemes: ` +
                        `${JSON.stringify(schemes)}`);
      }
    });

    it('/api/openapi.json exposes apiKey security in apikey mode', async function () {
      this.timeout(15000);
      const res = await agent.get('/api/openapi.json').expect(200);
      const schemes = res.body.components.securitySchemes;
      const hasApiKey = Object.values(schemes).some((s: any) => s.type === 'apiKey');
      if (!hasApiKey) {
        throw new Error(`Expected at least one apiKey securityScheme in ` +
                        `/api/openapi.json, got: ${JSON.stringify(schemes)}`);
      }
    });
  });

  describe('public OpenAPI spec shape (for downstream codegens)', function () {
    let spec: any;

    before(async function () {
      this.timeout(15000);
      spec = (await agent.get('/api/openapi.json').expect(200)).body;
    });

    it('declares a top-level tags array with all expected resource groups', function () {
      if (!Array.isArray(spec.tags)) {
        throw new Error(`Expected top-level tags to be an array, got ${typeof spec.tags}`);
      }
      const names = spec.tags.map((t: any) => t.name);
      const expected = ['pad', 'author', 'session', 'group', 'chat', 'server'];
      const missing = expected.filter((n) => !names.includes(n));
      if (missing.length) {
        throw new Error(`Top-level tags missing entries: ${missing.join(', ')}; got: ${names}`);
      }
    });

    it('tags every operation with at least one non-empty tag', function () {
      const untagged: string[] = [];
      for (const [path, methods] of Object.entries(spec.paths)) {
        for (const [method, op] of Object.entries(methods as any)) {
          const tags = (op as any).tags;
          if (!Array.isArray(tags) || tags.length === 0 || tags.some((t) => !t)) {
            untagged.push(`${method.toUpperCase()} ${path}`);
          }
        }
      }
      if (untagged.length) {
        throw new Error(`${untagged.length} operations are untagged: ${untagged.join(', ')}`);
      }
    });

    it('summarizes every operation', function () {
      const unsummarized: string[] = [];
      for (const [path, methods] of Object.entries(spec.paths)) {
        for (const [method, op] of Object.entries(methods as any)) {
          const summary = (op as any).summary;
          if (typeof summary !== 'string' || summary.trim().length < 3) {
            unsummarized.push(
                `${method.toUpperCase()} ${path} (summary=${JSON.stringify(summary)})`);
          }
        }
      }
      if (unsummarized.length) {
        throw new Error(
            `${unsummarized.length} operations have empty/missing summaries: ` +
            unsummarized.join(', '));
      }
    });

    it('advertises only POST per path (downstream tooling cleanliness)', function () {
      const offenders: string[] = [];
      for (const [path, methods] of Object.entries(spec.paths)) {
        const verbs = Object.keys(methods as any);
        if (verbs.length !== 1 || verbs[0] !== 'post') {
          offenders.push(`${path} has methods: ${verbs.join(', ')}`);
        }
      }
      if (offenders.length) {
        throw new Error(
            `Public spec must advertise only POST per path; offenders:\n  ${
              offenders.join('\n  ')}`);
      }
    });
  });

  describe('runtime backward compatibility (GET + POST still routed)', function () {
    // The runtime spec used by openapi-backend keeps both verbs even though the
    // public /api/openapi.json advertises POST only. The point of these tests
    // is to prove openapi-backend still resolves both verbs to the handler
    // — not to exercise auth. A 401 (or any non-`code 3` body) proves the
    // request reached the handler. `code: 3` is Etherpad's "no such function"
    // response, returned by openapi-backend's notFound when a method is not
    // declared in the runtime spec.

    const assertResolved = (path: string, body: any) => {
      if (body && body.code === 3) {
        throw new Error(
            `${path} got 'no such function' (code 3) — runtime spec dropped the ` +
            `verb. Response body: ${JSON.stringify(body)}`);
      }
    };

    it('GET requests still reach the API handler', async function () {
      const r = await agent.get(endPoint('checkToken'));
      assertResolved('GET checkToken', r.body);
    });

    it('POST requests still reach the API handler', async function () {
      const r = await agent.post(endPoint('checkToken'));
      assertResolved('POST checkToken', r.body);
    });

    // Regression for the REST-style routes — checkToken's _restPath is
    // derived from its position in the resources map (pad/checkToken).
    // Tagging it as 'server' must not move it to /rest/X/server/checkToken.
    it('REST-style /rest/<ver>/pad/checkToken still resolves', async function () {
      const r = await agent.get(`/rest/${apiVersion}/pad/checkToken`);
      assertResolved('GET /rest pad/checkToken', r.body);
    });
  });

  describe('helpful error when calling a function with too-old an API version (Issue #6849)', function () {
    it('returns helpful error when calling copyPad with API version 1', async function () {
      await agent.get('/api/1/copyPad')
          .expect(404)
          .expect((res: any) => {
            if (res.body.code !== 3) {
              throw new Error(`Expected code 3 (not found), got ${res.body.code}`);
            }
            if (res.body.message !== "'copyPad' is available from API v1.2.8 onwards.") {
              throw new Error(`Expected helpful error message, got: ${res.body.message}`);
            }
          });
    });
  });
});
