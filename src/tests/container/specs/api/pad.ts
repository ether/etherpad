/*
 * ACHTUNG: this file was copied & modified from the analogous
 * <basedir>/tests/backend/specs/api/pad.js
 *
 * TODO: unify those two files, and merge in a single one.
 */

import { describe, it } from 'vitest';
import supertest from 'supertest';
import { loadSettings } from '../../loadSettings.js';

const settings = loadSettings();
const api = supertest(`http://${settings.ip}:${settings.port}`);
const apiVersion = 1;

describe('Connectivity', function () {
  it('can connect', function (done) {
    api.get('/api/')
        .expect('Content-Type', /json/)
        .expect(200, done);
  });
});

describe('API Versioning', function () {
  it('finds the version tag', function (done) {
    api.get('/api/')
        .expect((res) => {
          if (!res.body.currentVersion) throw new Error('No version set in API');
          return;
        })
        .expect(200, done);
  });
});

describe('Permission', function () {
  it('errors with invalid OAuth token', function (done) {
    api.get(`/api/${apiVersion}/createPad?padID=test`)
        .expect(401, done);
  });
});
