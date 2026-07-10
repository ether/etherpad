'use strict';

// Regression test for ether/etherpad#8026.
//
// docker-compose.yml mounts a named volume over src/plugin_packages while the
// app runs as UID 5001. Docker initializes a fresh named volume from the image's
// mountpoint metadata, so the runtime image must provide that directory owned by
// the etherpad user. If the directory is absent, Docker creates it as root:root
// and plugin installs fail when install.lock is created.

const assert = require('assert').strict;
import fs from 'fs';
import path from 'path';

const repoRoot = path.join(__dirname, '../../../../');
const readRepoFile = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

const getStage = (dockerfile: string, stageName: string): string => {
  const stageStart = new RegExp(`^FROM\\s+\\S+\\s+AS\\s+${stageName}\\b`, 'm').exec(dockerfile);
  assert.ok(stageStart, `Dockerfile must define a ${stageName} stage`);

  const rest = dockerfile.slice(stageStart.index);
  const nextStage = /^FROM\s+/m.exec(rest.slice(stageStart[0].length));
  if (nextStage == null) return rest;
  return rest.slice(0, stageStart[0].length + nextStage.index);
};

describe(__filename, function () {
  describe('Docker plugin package volume mountpoint (issue #8026)', function () {
    let dockerfile: string;

    before(function () {
      dockerfile = readRepoFile('Dockerfile');
    });

    for (const stageName of ['development', 'production']) {
      it(`creates src/plugin_packages in the ${stageName} runtime stage`, function () {
        const stage = getStage(dockerfile, stageName);
        const srcCopy = stage.indexOf('COPY --chown=etherpad:etherpad ./src');
        const mkdir = stage.indexOf('RUN mkdir -p ./src/plugin_packages');

        assert.notStrictEqual(srcCopy, -1,
            `Dockerfile ${stageName} stage must copy ./src before preparing plugin_packages`);
        assert.notStrictEqual(mkdir, -1,
            `Dockerfile ${stageName} stage must create ./src/plugin_packages so a fresh ` +
            'Docker named volume is initialized writable by the etherpad user');
        assert.ok(mkdir > srcCopy,
            `Dockerfile ${stageName} stage must create ./src/plugin_packages after copying ./src`);
      });
    }
  });
});
