'use strict';

import {strict as assert} from 'assert';
const validateOpenAPI = require('openapi-schema-validation').validate;

const openapiAdmin = require('../../../node/hooks/express/openapi-admin');

describe('admin OpenAPI document', function () {
  let doc: any;

  before(function () {
    doc = openapiAdmin.generateAdminDefinition();
  });

  it('returns a valid OpenAPI 3.0 document', function () {
    const {valid, errors} = validateOpenAPI(doc, 3);
    if (!valid) {
      throw new Error(
        `admin OpenAPI doc is invalid: ${JSON.stringify(errors, null, 2)}`,
      );
    }
  });

  it('declares info.title as "Etherpad Admin API"', function () {
    assert.equal(doc.info.title, 'Etherpad Admin API');
  });

  it('exposes basicAuth and sessionCookie security schemes', function () {
    assert.ok(doc.components.securitySchemes.basicAuth);
    assert.equal(doc.components.securitySchemes.basicAuth.type, 'http');
    assert.equal(doc.components.securitySchemes.basicAuth.scheme, 'basic');
    assert.ok(doc.components.securitySchemes.sessionCookie);
    assert.equal(doc.components.securitySchemes.sessionCookie.type, 'apiKey');
    assert.equal(doc.components.securitySchemes.sessionCookie.in, 'cookie');
  });
});
