'use strict';

import {ArgsExpressType} from '../../types/ArgsExpressType';
import settings, {getEpVersion} from '../../utils/Settings';

const OPENAPI_VERSION = '3.0.2';

/**
 * Build the OpenAPI 3.0 document for Etherpad's admin endpoints.
 *
 * Distinct from the public versioned API document built by openapi.ts —
 * admin routes are plain Express handlers (not APIHandler-driven), so this
 * spec is hand-authored. The shape is consumed by admin/scripts/dump-spec.ts
 * for client-side codegen, and (when settings.adminOpenAPI.enabled) exposed
 * at GET /admin/openapi.json for downstream tooling.
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
  paths: {
    '/admin-auth/': {
      post: {
        operationId: 'verifyAdminAccess',
        summary: 'Verify or establish an admin session',
        description:
          'POST with `Authorization: Basic <user:pass>` to log in as an admin ' +
          '(server sets a session cookie on success). POST with no auth header ' +
          'to verify an existing admin session cookie. The response body is ' +
          'always empty; the status code conveys the outcome.',
        security: [
          {basicAuth: []},
          {sessionCookie: []},
          {},
        ],
        responses: {
          '200': {description: 'Caller is an authenticated admin.'},
          '401': {description: 'No authentication presented and no admin session exists.'},
          '403': {description: 'Authenticated, but the user is not an admin.'},
        },
      },
    },
    '/admin/update/status': {
      get: {
        operationId: 'getUpdateStatus',
        summary: 'Fetch updater status for the admin UI banner and update page',
        description:
          'Returns the cached update state (current version, latest known release, ' +
          'install method, tier, policy verdict, and vulnerability directives). ' +
          'Open by default; gated to authenticated admin sessions when ' +
          'updates.requireAdminForStatus=true in settings.',
        security: [
          {sessionCookie: []},
          {},
        ],
        responses: {
          '200': {
            description: 'Update status payload.',
            content: {
              'application/json': {
                schema: {$ref: '#/components/schemas/UpdateStatus'},
              },
            },
          },
          '401': {
            description: 'requireAdminForStatus is set and no admin session exists.',
          },
          '403': {
            description: 'requireAdminForStatus is set and the session user is not an admin.',
          },
        },
      },
    },
  },
  components: {
    schemas: {
      ReleaseInfo: {
        type: 'object',
        required: ['version', 'tag', 'body', 'publishedAt', 'prerelease', 'htmlUrl'],
        properties: {
          version:     {type: 'string', description: 'Semver string without leading "v".'},
          tag:         {type: 'string', description: 'Original GitHub tag_name (e.g. "v2.7.2").'},
          body:        {type: 'string', description: 'Markdown body of the release.'},
          publishedAt: {type: 'string', format: 'date-time'},
          prerelease:  {type: 'boolean'},
          htmlUrl:     {type: 'string', format: 'uri'},
        },
      },
      PolicyResult: {
        type: 'object',
        required: ['canNotify', 'canManual', 'canAuto', 'canAutonomous', 'reason'],
        properties: {
          canNotify:     {type: 'boolean'},
          canManual:     {type: 'boolean'},
          canAuto:       {type: 'boolean'},
          canAutonomous: {type: 'boolean'},
          reason:        {type: 'string'},
        },
      },
      UpdateStatus: {
        type: 'object',
        required: ['currentVersion', 'installMethod', 'tier'],
        properties: {
          currentVersion: {type: 'string'},
          latest: {
            allOf: [{$ref: '#/components/schemas/ReleaseInfo'}],
            nullable: true,
          },
          lastCheckAt: {type: 'string', format: 'date-time', nullable: true},
          installMethod: {
            type: 'string',
            enum: ['auto', 'git', 'docker', 'npm', 'managed'],
          },
          tier: {
            type: 'string',
            enum: ['off', 'notify', 'manual', 'auto', 'autonomous'],
          },
          policy: {
            allOf: [{$ref: '#/components/schemas/PolicyResult'}],
            nullable: true,
          },
        },
      },
    },
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

export const expressPreSession = async (
  _hookName: string,
  {app}: ArgsExpressType,
): Promise<void> => {
  // Behind a feature flag, default off. Etherpad policy
  // (CONTRIBUTING.md, AGENTS.MD) requires new features to ship disabled by
  // default. The route is only useful for third-party tooling — codegen
  // imports generateAdminDefinition() in-process and does not depend on it.
  //
  // The flag is checked per-request (not at registration time) so toggling
  // settings.adminOpenAPI.enabled at runtime takes effect immediately and
  // so test suites that share a long-lived Express agent can exercise both
  // states without restarting the server.
  app.get('/admin/openapi.json', (_req: any, res: any) => {
    if (!settings.adminOpenAPI?.enabled) {
      // Return JSON 404 (not the SPA's text/html catch-all) so callers get
      // a clear "feature disabled" signal rather than an HTML page.
      return res.status(404).type('application/json').send({error: 'Not Found'});
    }
    res.header('Access-Control-Allow-Origin', '*');
    res.json(generateAdminDefinition());
  });
};

exports.expressPreSession = expressPreSession;
