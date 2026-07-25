'use strict';

/**
 * SSRF regression for the LibreOffice (`soffice`) export path.
 *
 * The native (in-process) export path strips remote `<img>` tags before
 * rendering, but the `soffice` path historically wrote the full export HTML to
 * disk verbatim and handed it to LibreOffice, which fetches remote image URLs
 * during conversion — a blind SSRF sink reachable whenever a plugin/hook injects
 * image tags into export HTML. Reported by `meifukun`.
 *
 * This test drives the real export handler with:
 *   - an `exportHTMLAdditionalContent` hook that injects a remote image (the
 *     documented plugin extension point from the PoC), and
 *   - an `exportConvert` hook that stands in for LibreOffice: it captures the
 *     exact HTML written to the temp file and writes a dummy output so the
 *     request completes.
 * It then asserts the captured HTML contains no remote image URL.
 */

import {MapArrayType} from "../../../node/types/MapType";
import fs from 'node:fs';
const fsp = fs.promises;

const assert = require('assert').strict;
const common = require('../common');
const padManager = require('../../../node/db/PadManager');
const plugins = require('../../../static/js/pluginfw/plugin_defs');
import settings from '../../../node/utils/Settings';

const REMOTE_IMG = '<img src="http://127.0.0.1:39111/ssrf-marker-soffice" alt="probe">';

describe(__filename, function () {
  this.timeout(30000);
  let agent: any;
  const settingsBackup: MapArrayType<any> = {};
  const hookBackup: MapArrayType<any> = {};
  const hookNames = ['exportHTMLAdditionalContent', 'exportConvert'];
  let capturedHtml = '';

  const makeHook = (hookName: string, hookFn: Function) => ({
    hook_fn: hookFn,
    hook_fn_name: `ssrf_test/${hookName}`,
    hook_name: hookName,
    part: {plugin: 'ssrf_test'},
  });

  before(async function () {
    agent = await common.init();
    settingsBackup.soffice = settings.soffice;
    await padManager.getPad('sofficeSsrfPad', 'test content');
  });

  beforeEach(function () {
    for (const h of hookNames) {
      hookBackup[h] = plugins.hooks[h];
    }
    capturedHtml = '';
    // Inject a remote image the way a plugin extension point would.
    plugins.hooks.exportHTMLAdditionalContent = [
      makeHook('exportHTMLAdditionalContent', () => REMOTE_IMG),
    ];
    // Stand in for LibreOffice: capture what was written, produce a dummy file.
    plugins.hooks.exportConvert = [
      makeHook('exportConvert', async (hookName: string, {srcFile, destFile}: any) => {
        capturedHtml = await fsp.readFile(srcFile, 'utf8');
        await fsp.writeFile(destFile, 'dummy-converted-output');
        return 'handled';
      }),
    ];
    // Force the soffice conversion path (non-null => sofficeAvailable() === 'yes'
    // on non-Windows). The binary is never actually spawned because the
    // exportConvert hook short-circuits the converter.
    settings.soffice = '/usr/bin/soffice';
  });

  afterEach(function () {
    for (const h of hookNames) {
      plugins.hooks[h] = hookBackup[h];
    }
  });

  after(function () {
    Object.assign(settings, settingsBackup);
  });

  it('confirms the injected remote image reaches the export HTML', async function () {
    // Sanity check on the harness: the raw HTML export (which is NOT run through
    // the soffice temp-file path) must contain the injected image, proving the
    // hook fires and the marker would otherwise be present.
    const res = await agent.get('/p/sofficeSsrfPad/export/html').expect(200);
    assert.ok(
        res.text.includes('ssrf-marker-soffice'),
        'expected the injected remote image to appear in the html export');
  });

  it('strips remote images from the HTML handed to the soffice converter',
      async function () {
        await agent.get('/p/sofficeSsrfPad/export/odt').expect(200);
        assert.ok(capturedHtml.length > 0, 'exportConvert hook did not capture any HTML');
        assert.ok(
            !capturedHtml.includes('ssrf-marker-soffice'),
            `soffice temp file still contains the remote image URL:\n${capturedHtml}`);
        assert.ok(
            !/<img[^>]+src\s*=\s*["']?https?:/i.test(capturedHtml),
            `soffice temp file still contains a remote <img src="http...">:\n${capturedHtml}`);
      });
});
