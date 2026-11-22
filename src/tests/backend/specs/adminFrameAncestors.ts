'use strict';

/**
 * The admin UI must only be frameable by its own origin, while pads and
 * every other page must stay frameable so embedded pads keep working.
 */

const assert = require('assert').strict;
const common = require('../common');
const padManager = require('../../../node/db/PadManager');
import settings from '../../../node/utils/Settings';

let agent: any;

const assertAdminProtected = (res: any, where: string) => {
  assert.equal(res.headers['content-security-policy'], "frame-ancestors 'self'",
      `${where}: missing frame-ancestors`);
  assert.equal(res.headers['x-frame-options'], 'SAMEORIGIN', `${where}: missing X-Frame-Options`);
};

const assertFrameable = (res: any, where: string) => {
  assert.equal(res.headers['x-frame-options'], undefined, `${where}: must not send X-Frame-Options`);
  const csp = String(res.headers['content-security-policy'] || '');
  assert(!/frame-ancestors/i.test(csp), `${where}: must not send frame-ancestors (got "${csp}")`);
};

describe(__filename, function () {
  this.timeout(30000);
  const padId = 'AdminFrameAncestorsTest';
  let backup: any;

  before(async function () {
    agent = await common.init();
    await padManager.getPad(padId, 'test content');
    backup = settings.adminFrameAncestors;
  });

  afterEach(function () {
    settings.adminFrameAncestors = backup;
  });

  describe('admin UI is not frameable by other origins', function () {
    for (const p of ['/admin/', '/admin/plugins', '/admin/settings', '/ADMIN/', '/admin-auth/']) {
      it(`GET ${p}`, async function () {
        const res = await agent.get(p);
        assertAdminProtected(res, `GET ${p}`);
      });
    }

    it('POST /admin-auth/ (failed login) is protected too', async function () {
      const res = await agent.post('/admin-auth/');
      assertAdminProtected(res, 'POST /admin-auth/');
    });

    it('/admin/ behind a proxy path prefix is protected', async function () {
      const res = await agent.get('/admin/').set('x-proxy-path', '/etherpad');
      assertAdminProtected(res, 'GET /admin/ with x-proxy-path');
    });
  });

  describe('pads and other pages stay frameable', function () {
    const paths = () => [
      '/',
      `/p/${padId}`,
      `/p/${padId}/timeslider`,
      `/p/${padId}/export/html`,
      `/p/${padId}/export/txt`,
      '/static/js/pad.js',
      '/p/admin',
      '/administrator',
    ];
    for (const p of paths()) {
      it(`GET ${p}`, async function () {
        const res = await agent.get(p);
        assertFrameable(res, `GET ${p}`);
      });
    }

    it('a pad page with x-proxy-path stays frameable', async function () {
      const res = await agent.get(`/p/${padId}`).set('x-proxy-path', '/etherpad');
      assertFrameable(res, `GET /p/${padId} with x-proxy-path`);
    });

    it('pads stay frameable when adminFrameAncestors is set', async function () {
      settings.adminFrameAncestors = ['https://portal.example.com'];
      const res = await agent.get(`/p/${padId}`);
      assertFrameable(res, `GET /p/${padId}`);
    });
  });

  describe('adminFrameAncestors setting', function () {
    it('lets an operator allow extra origins to frame the admin UI', async function () {
      settings.adminFrameAncestors = ['https://portal.example.com'];
      const res = await agent.get('/admin/');
      assert.equal(res.headers['content-security-policy'],
          "frame-ancestors 'self' https://portal.example.com");
      assert.equal(res.headers['x-frame-options'], undefined);
    });

    it('ignores entries that would inject into the header', async function () {
      settings.adminFrameAncestors = ["https://x.example; script-src 'unsafe-inline'"];
      const res = await agent.get('/admin/');
      assertAdminProtected(res, 'GET /admin/ with an invalid entry');
    });
  });
});
