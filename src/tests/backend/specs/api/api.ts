'use strict';

/**
 * API specs
 *
 * Tests for generic overarching HTTP API related features not related to any
 * specific part of the data model or domain. For example: tests for versioning
 * and openapi definitions.
 */

import * as common from '../../common.js';
import openApiSchemaValidation from 'openapi-schema-validation';
import settings from '../../../../node/utils/Settings.js';
import {fileURLToPath} from 'node:url';

const validateOpenAPI = openApiSchemaValidation.validate;
const __filename = fileURLToPath(import.meta.url);

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
});
