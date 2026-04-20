'use strict';

import {MapArrayType} from "../../../node/types/MapType";

const assert = require('assert').strict;
const common = require('../common');
const padManager = require('../../../node/db/PadManager');
import settings from '../../../node/utils/Settings';

describe(__filename, function () {
  let agent:any;
  const settingsBackup:MapArrayType<any> = {};

  before(async function () {
    agent = await common.init();
    settingsBackup.soffice = settings.soffice;
    settingsBackup.nativeDocxExport = settings.nativeDocxExport;
    await padManager.getPad('testExportPad', 'test content');
  });

  after(async function () {
    Object.assign(settings, settingsBackup);
  });

  it('returns 500 on export error', async function () {
    settings.soffice = 'false'; // '/bin/false' doesn't work on Windows
    settings.nativeDocxExport = false;
    await agent.get('/p/testExportPad/export/doc')
        .expect(500);
  });

  // Issue #7538: in-process DOCX export via html-to-docx bypasses the
  // soffice requirement entirely. A deployment with `soffice: false` and
  // `nativeDocxExport: true` should still produce a working .docx.
  describe('native DOCX export (#7538)', function () {
    before(function () {
      // The upgrade-from-latest-release CI job installs deps from the
      // PREVIOUS release's package.json (before this PR adds html-to-docx)
      // and then git-checkouts this branch's code without re-running
      // `pnpm install`. Under that workflow the module isn't resolvable.
      // Skip the block in that one case; regular backend tests (which
      // install against this branch's lockfile) still exercise it.
      try {
        require.resolve('html-to-docx');
      } catch {
        this.skip();
        return;
      }
      settings.soffice = 'false';
      settings.nativeDocxExport = true;
    });

    it('returns a valid DOCX archive (PK zip signature)', async function () {
      const res = await agent.get('/p/testExportPad/export/docx')
          .buffer(true)
          .parse((resp: any, callback: any) => {
            const chunks: Buffer[] = [];
            resp.on('data', (chunk: Buffer) => chunks.push(chunk));
            resp.on('end', () => callback(null, Buffer.concat(chunks)));
          })
          .expect(200);
      const body: Buffer = res.body as Buffer;
      assert.ok(body.length > 0, 'DOCX body must not be empty');
      // Word .docx files are ZIP archives — must start with the ZIP local
      // file header signature 0x504b0304 ("PK\x03\x04").
      assert.strictEqual(body[0], 0x50, 'byte 0 (P)');
      assert.strictEqual(body[1], 0x4b, 'byte 1 (K)');
      assert.strictEqual(body[2], 0x03, 'byte 2');
      assert.strictEqual(body[3], 0x04, 'byte 3');
    });

    it('sends the Word-processing-ml content-type', async function () {
      const res = await agent.get('/p/testExportPad/export/docx').expect(200);
      assert.match(res.headers['content-type'],
          /application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document/,
          `unexpected content-type: ${res.headers['content-type']}`);
    });
  });
});
