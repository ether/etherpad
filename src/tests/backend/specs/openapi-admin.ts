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

  describe('/admin-auth/', function () {
    it('declares POST with operationId verifyAdminAccess', function () {
      const op = doc.paths['/admin-auth/']?.post;
      assert.ok(op, 'POST /admin-auth/ is missing');
      assert.equal(op.operationId, 'verifyAdminAccess');
    });

    it('documents responses 200, 401, 403', function () {
      const responses = doc.paths['/admin-auth/'].post.responses;
      assert.ok(responses['200'], 'missing 200 response');
      assert.ok(responses['401'], 'missing 401 response');
      assert.ok(responses['403'], 'missing 403 response');
    });

    it('declares security: basicAuth, sessionCookie, anonymous', function () {
      const security = doc.paths['/admin-auth/'].post.security;
      assert.ok(Array.isArray(security));
      const keys = security.map((s: any) => Object.keys(s)[0] ?? '__anon__');
      assert.deepEqual(keys.sort(), ['__anon__', 'basicAuth', 'sessionCookie'].sort());
    });
  });

  describe('/admin/update/status', function () {
    it('declares GET with operationId getUpdateStatus', function () {
      const op = doc.paths['/admin/update/status']?.get;
      assert.ok(op, 'GET /admin/update/status is missing');
      assert.equal(op.operationId, 'getUpdateStatus');
    });

    it('200 response references components.schemas.UpdateStatus', function () {
      const ok = doc.paths['/admin/update/status'].get.responses['200'];
      assert.equal(
        ok.content['application/json'].schema.$ref,
        '#/components/schemas/UpdateStatus',
      );
    });

    it('declares security: sessionCookie OR anonymous', function () {
      const security = doc.paths['/admin/update/status'].get.security;
      const keys = security.map((s: any) => Object.keys(s)[0] ?? '__anon__');
      assert.deepEqual(keys.sort(), ['__anon__', 'sessionCookie'].sort());
    });
  });

  describe('UpdateStatus schema', function () {
    it('declares all properties emitted by the handler', function () {
      const schema = doc.components.schemas.UpdateStatus;
      assert.equal(schema.type, 'object');
      const props = Object.keys(schema.properties).sort();
      assert.deepEqual(props, [
        'currentVersion',
        'installMethod',
        'lastCheckAt',
        'latest',
        'policy',
        'tier',
        'vulnerableBelow',
      ]);
    });

    it('installMethod enum matches updater/types.ts InstallMethod', function () {
      const enums = doc.components.schemas.UpdateStatus.properties.installMethod.enum;
      assert.deepEqual(enums.slice().sort(), ['auto', 'docker', 'git', 'managed', 'npm']);
    });

    it('tier enum matches updater/types.ts Tier', function () {
      const enums = doc.components.schemas.UpdateStatus.properties.tier.enum;
      assert.deepEqual(enums.slice().sort(), ['auto', 'autonomous', 'manual', 'notify', 'off']);
    });

    it('declares ReleaseInfo, PolicyResult, VulnerableBelowDirective sub-schemas', function () {
      assert.ok(doc.components.schemas.ReleaseInfo);
      assert.ok(doc.components.schemas.PolicyResult);
      assert.ok(doc.components.schemas.VulnerableBelowDirective);
    });

    it('ReleaseInfo properties mirror updater/types.ts', function () {
      const props = Object.keys(doc.components.schemas.ReleaseInfo.properties).sort();
      assert.deepEqual(props, [
        'body', 'htmlUrl', 'prerelease', 'publishedAt', 'tag', 'version',
      ]);
    });

    it('PolicyResult properties mirror updater/types.ts', function () {
      const props = Object.keys(doc.components.schemas.PolicyResult.properties).sort();
      assert.deepEqual(props, [
        'canAuto', 'canAutonomous', 'canManual', 'canNotify', 'reason',
      ]);
    });

    it('VulnerableBelowDirective properties mirror updater/types.ts', function () {
      const props = Object.keys(doc.components.schemas.VulnerableBelowDirective.properties).sort();
      assert.deepEqual(props, ['announcedBy', 'threshold']);
    });
  });

  describe('cross-collision with public spec', function () {
    let publicDoc: any;
    before(function () {
      const apiHandler = require('../../../node/handler/APIHandler');
      const openapi = require('../../../node/hooks/express/openapi');
      publicDoc = openapi.generateDefinitionForVersion(
        apiHandler.latestApiVersion,
        openapi.APIPathStyle.FLAT,
      );
    });

    it('admin paths and operationIds do not collide with the latest public spec', function () {
      const adminPaths = Object.keys(doc.paths);
      const publicPaths = Object.keys(publicDoc.paths);
      const pathCollisions = adminPaths.filter((p) => publicPaths.includes(p));
      assert.deepEqual(pathCollisions, [], `path collisions: ${pathCollisions.join(', ')}`);

      const collectOpIds = (d: any): string[] => {
        const ids: string[] = [];
        for (const item of Object.values(d.paths) as any[]) {
          for (const op of Object.values(item) as any[]) {
            if (op && typeof op.operationId === 'string') ids.push(op.operationId);
          }
        }
        return ids;
      };
      const adminIds = collectOpIds(doc);
      const publicIds = collectOpIds(publicDoc);
      const idCollisions = adminIds.filter((id) => publicIds.includes(id));
      assert.deepEqual(idCollisions, [], `operationId collisions: ${idCollisions.join(', ')}`);
    });

    it('schema names do not collide with the latest public spec', function () {
      const adminSchemas = Object.keys(doc.components.schemas);
      const publicSchemas = Object.keys(publicDoc.components.schemas || {});
      const collisions = adminSchemas.filter((n) => publicSchemas.includes(n));
      assert.deepEqual(collisions, [], `schema name collisions: ${collisions.join(', ')}`);
    });
  });
});
