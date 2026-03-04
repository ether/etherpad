'use strict';

import {MapArrayType} from "../../../node/types/MapType";

const assert = require('assert').strict;
const common = require('../common');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
import settings from '../../../node/utils/Settings';
const superagent = require('superagent');

describe(__filename, function () {
  let agent:any;
  let backupSettings:MapArrayType<any>;
  let skinDir: string;
  let wantCustomIcon: boolean;
  let wantDefaultIcon: boolean;
  let wantSkinIcon: boolean;

  before(async function () {
    agent = await common.init();
    wantCustomIcon = await fsp.readFile(path.join(__dirname, 'favicon-test-custom.png'));
    wantDefaultIcon = await fsp.readFile(path.join(settings.root, 'src', 'static', 'favicon.ico'));
    wantSkinIcon = await fsp.readFile(path.join(__dirname, 'favicon-test-skin.png'));
  });

  beforeEach(async function () {
    backupSettings = {...settings};
    skinDir = await fsp.mkdtemp(path.join(settings.root, 'src', 'static', 'skins', 'test-'));
    settings.skinName = path.basename(skinDir);

  });

  afterEach(async function () {
    // @ts-ignore
    delete settings.favicon;
    // @ts-ignore
    delete settings.skinName;
    Object.assign(settings, backupSettings);
    try {
      // TODO: The {recursive: true} option wasn't added to fsp.rmdir() until Node.js v12.10.0 so we
      // can't rely on it until support for Node.js v10 is dropped.
      await fsp.unlink(path.join(skinDir, 'favicon.ico'));
      await fsp.rmdir(skinDir, {recursive: true});
    } catch (err) { /* intentionally ignored */ }
  });

  it('uses custom favicon if set (relative pathname)', async function () {
    settings.favicon =
        path.relative(settings.root, path.join(__dirname, 'favicon-test-custom.png'));
    assert(!path.isAbsolute(settings.favicon));
    const {body: gotIcon} = await agent.get('/favicon.ico')
        .accept('png').buffer(true).parse(superagent.parse.image)
        .expect(200);
    assert(gotIcon.equals(wantCustomIcon));
  });

  it('uses custom favicon from url', async function () {
    settings.favicon = 'https://etherpad.org/favicon.ico';
    await agent.get('/favicon.ico')
        .expect(302);
  });

  it('uses custom favicon if set (absolute pathname)', async function () {
    settings.favicon = path.join(__dirname, 'favicon-test-custom.png');
    assert(path.isAbsolute(settings.favicon));
    const {body: gotIcon} = await agent.get('/favicon.ico')
        .accept('png').buffer(true).parse(superagent.parse.image)
        .expect(200);
    assert(gotIcon.equals(wantCustomIcon));
  });

  it('falls back if custom favicon is missing', async function () {
    // The previous default for settings.favicon was 'favicon.ico', so many users will continue to
    // have that in their settings.json for a long time. There is unlikely to be a favicon at
    // path.resolve(settings.root, 'favicon.ico'), so this test ensures that 'favicon.ico' won't be
    // a problem for those users.
    settings.favicon = 'favicon.ico';
    const {body: gotIcon} = await agent.get('/favicon.ico')
        .accept('png').buffer(true).parse(superagent.parse.image)
        .expect(200);
    assert(gotIcon.equals(wantDefaultIcon));
  });

  it('uses skin favicon if present', async function () {
    await fsp.writeFile(path.join(skinDir, 'favicon.ico'), wantSkinIcon);
    settings.favicon = null;
    const {body: gotIcon} = await agent.get('/favicon.ico')
        .accept('png').buffer(true).parse(superagent.parse.image)
        .expect(200);
    assert(gotIcon.equals(wantSkinIcon));
  });

  it('falls back to default favicon', async function () {
    settings.favicon = null;
    const {body: gotIcon} = await agent.get('/favicon.ico')
        .accept('png').buffer(true).parse(superagent.parse.image)
        .expect(200);
    assert(gotIcon.equals(wantDefaultIcon));
  });
});
