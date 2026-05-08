'use strict';

import {getEpVersion} from '../../utils/Settings';

const OPENAPI_VERSION = '3.0.2';

/**
 * Build the OpenAPI 3.0 document for Etherpad's admin endpoints.
 *
 * Distinct from the public versioned API document built by openapi.ts —
 * admin routes are plain Express handlers (not APIHandler-driven), so this
 * spec is hand-authored. The shape is consumed by admin/scripts/dump-spec.ts
 * for client-side codegen and exposed at GET /admin/openapi.json for
 * downstream tooling.
 */
export const generateAdminDefinition = (): any => ({
  openapi: OPENAPI_VERSION,
  info: {
    title: 'Etherpad Admin API',
    description:
      'Authenticated administrative endpoints consumed by the Etherpad admin UI. ' +
      'Distinct from the public /api/{version}/* surface served by /api/openapi.json.',
    version: getEpVersion(),
  },
  paths: {},
  components: {
    schemas: {},
    securitySchemes: {
      basicAuth: {
        type: 'http',
        scheme: 'basic',
      },
      sessionCookie: {
        type: 'apiKey',
        in: 'cookie',
        name: 'express_sid',
      },
    },
  },
});

exports.generateAdminDefinition = generateAdminDefinition;
