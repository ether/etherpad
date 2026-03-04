/*
 * Usage -- see README.md
 *
 * Normal usage:                node bin/plugins/checkPlugin.js ep_whatever
 * Auto fix the things it can:  node bin/plugins/checkPlugin.js ep_whatever autofix
 * Auto fix and commit:         node bin/plugins/checkPlugin.js ep_whatever autocommit
 * Auto fix, commit, push and publish to npm (highly dangerous):
 *                              node bin/plugins/checkPlugin.js ep_whatever autopush
 */

import process from 'node:process';

// As of v14, Node.js does not exit when there is an unhandled Promise rejection. Convert an
// unhandled rejection into an uncaught exception, which does cause Node.js to exit.
process.on('unhandledRejection', (err) => { throw err; });

import {strict as assert} from 'assert';
import fs from 'node:fs';
const fsp = fs.promises;
import childProcess from 'node:child_process';
import log4js from 'log4js';
import path from 'node:path';
import semver from "semver";

const logger = log4js.getLogger('checkPlugin');
log4js.configure({
  appenders: { console: { type: "console" } },
  categories: { default: { appenders: ["console"], level: "info" } },
});
(async () => {
  // get plugin name & path from user input
  const pluginName = process.argv[2];

  if (!pluginName) throw new Error('no plugin name specified');
  logger.info(`Checking the plugin: ${pluginName}`);

  const epRootDir = await fsp.realpath(path.join(await fsp.realpath(__dirname), '../..'));
  logger.info(`Etherpad root directory: ${epRootDir}`);
  process.chdir(epRootDir);
  const pluginPath = await fsp.realpath(`../${pluginName}`);
  logger.info(`Plugin directory: ${pluginPath}`);
  const epSrcDir = await fsp.realpath(path.join(epRootDir, 'src'));

  const optArgs = process.argv.slice(3);
  const autoPush = optArgs.includes('autopush');
  const autoCommit = autoPush || optArgs.includes('autocommit');
  const autoFix = autoCommit || optArgs.includes('autofix');

  const execSync = (cmd:string, opts = {}) => (childProcess.execSync(cmd, {
    cwd: `${pluginPath}/`,
    ...opts,
  }) || '').toString().replace(/\n+$/, '');

  const writePackageJson = async (obj: object) => {
    console.log("writing package.json",obj)
    let s = JSON.stringify(obj, null, 2);
    if (s.length && s.slice(s.length - 1) !== '\n') s += '\n';
    return await fsp.writeFile(`${pluginPath}/package.json`, s);
  };

  const checkEntries = (got: any, want:any) => {
    let changed = false;
    for (const [key, val] of Object.entries(want)) {
      try {
        assert.deepEqual(got[key], val);
      } catch (err:any) {
        logger.warn(`${key} possibly outdated.`);
        logger.warn(err.message);
        if (autoFix) {
          got[key] = val;
          changed = true;
        }
      }
    }
    return changed;
  };

  const updateDeps = async (parsedPackageJson: any, key: string, wantDeps: {
    [key: string]: string | {ver?: string, overwrite?: boolean}|null
  }|string) => {
    const {[key]: deps = {}} = parsedPackageJson;
    let changed = false;

    if (typeof wantDeps === 'string') {
      if (deps !== wantDeps) {
        logger.warn(`Dependency mismatch in ${key}: '${wantDeps}' (current: ${deps})`);
        if (autoFix) {
          parsedPackageJson[key] = wantDeps;
          await writePackageJson(parsedPackageJson);
        }
      }
      return;
    }
    for (const [pkg, verInfo] of Object.entries(wantDeps)) {
      const {ver, overwrite = true} =
          typeof verInfo === 'string' || verInfo == null ? {ver: verInfo} : verInfo;
      if (deps[pkg] === ver || (deps[pkg] == null && ver == null)) continue;
      if (deps[pkg] == null) {
        logger.warn(`Missing dependency in ${key}: '${pkg}': '${ver}'`);
      } else {
        if (!overwrite) continue;
        logger.warn(`Dependency mismatch in ${key}: '${pkg}': '${ver}' (current: ${deps[pkg]})`);
      }
      if (autoFix) {
        if (ver == null) delete deps[pkg];
        else deps[pkg] = ver;
        changed = true;
      }
    }
    if (changed) {
      parsedPackageJson[key] = deps;
      await writePackageJson(parsedPackageJson);
    }
  };

  const prepareRepo = () => {
    const modified = execSync('git diff-files --name-status');
    if (modified !== '') {
      logger.warn('working directory has modifications');
      if (autoFix)
      execSync('git stash', {stdio: 'inherit'})
      //throw new Error(`working directory has modifications:\n${modified}`);
    }
    const untracked = execSync('git ls-files -o --exclude-standard');
    if (untracked !== '') throw new Error(`working directory has untracked files:\n${untracked}`);
    const indexStatus = execSync('git diff-index --cached --name-status HEAD');
    if (indexStatus !== '') throw new Error(`uncommitted staged changes to files:\n${indexStatus}`);
    let br;
    if (autoCommit) {
      br = execSync('git symbolic-ref HEAD');
      if (!br.startsWith('refs/heads/')) throw new Error('detached HEAD');
      br = br.replace(/^refs\/heads\//, '');
      execSync('git rev-parse --verify -q HEAD || ' +
               `{ echo "Error: no commits on ${br}" >&2; exit 1; }`);
      execSync('git config --get user.name');
      execSync('git config --get user.email');
    }
    if (autoPush) {
      if (!['master', 'main'].includes(br!)) throw new Error('master/main not checked out');
      execSync('git rev-parse --verify @{u}');
      execSync('git pull --ff-only', {stdio: 'inherit'});
      if (execSync('git rev-list @{u}...') !== '') throw new Error('repo contains unpushed commits');
    }
  };

  const checkFile = async (srcFn: string, dstFn:string, overwrite = true) => {
    const outFn = path.join(pluginPath, dstFn);
    const wantContents = await fsp.readFile(srcFn, {encoding: 'utf8'});
    let gotContents = null;
    try {
      gotContents = await fsp.readFile(outFn, {encoding: 'utf8'});
    } catch (err) { /* treat as if the file doesn't exist */ }
    try {
      assert.equal(gotContents, wantContents);
    } catch (err:any) {
      logger.warn(`File ${dstFn} does not match the default`);
      logger.warn(err.message);
      if (!overwrite && gotContents != null) {
        logger.warn('Leaving existing contents alone.');
        return;
      }
      if (autoFix) {
        await fsp.mkdir(path.dirname(outFn), {recursive: true});
        await fsp.writeFile(outFn, wantContents);
      }
    }
  };

  if (autoPush) {
    logger.warn('Auto push is enabled, I hope you know what you are doing...');
  }

  const files = await fsp.readdir(pluginPath);

  // some files we need to know the actual file name.  Not compulsory but might help in the future.
  const readMeFileName = files.filter((f) => f === 'README' || f === 'README.md')[0];

  if (!files.includes('.git')) throw new Error('No .git folder, aborting');
  prepareRepo();

  const workflows = ['backend-tests.yml', 'frontend-tests.yml', 'npmpublish.yml', 'test-and-release.yml'];
  await Promise.all(workflows.map(async (fn) => {
    await checkFile(`bin/plugins/lib/${fn}`, `.github/workflows/${fn}`);
  }));
  await checkFile('bin/plugins/lib/dependabot.yml', '.github/dependabot.yml');

  if (!files.includes('package.json')) {
    logger.warn('no package.json, please create');
  } else {
    const packageJSON =
        await fsp.readFile(`${pluginPath}/package.json`, {encoding: 'utf8', flag: 'r'});
    const parsedPackageJSON = JSON.parse(packageJSON);

    await updateDeps(parsedPackageJSON, 'devDependencies', {
      'eslint': '^8.57.0',
      'eslint-config-etherpad': '^4.0.4',
      // Changing the TypeScript version can break plugin code, so leave it alone if present.
      'typescript': {ver: '^5.4.2', overwrite: true},
      // These were moved to eslint-config-etherpad's dependencies so they can be removed:
      '@typescript-eslint/eslint-plugin': null,
      '@typescript-eslint/parser': null,
      'eslint-import-resolver-typescript': null,
      'eslint-plugin-cypress': null,
      'eslint-plugin-eslint-comments': null,
      'eslint-plugin-import': null,
      'eslint-plugin-mocha': null,
      'eslint-plugin-node': null,
      'eslint-plugin-prefer-arrow': null,
      'eslint-plugin-promise': null,
      'eslint-plugin-you-dont-need-lodash-underscore': null,
    });

    const currentVersion = semver.parse(parsedPackageJSON.version)!;
    const newVersion = currentVersion.inc('patch');

    await updateDeps(parsedPackageJSON, 'version', newVersion.version)


    await updateDeps(parsedPackageJSON, 'peerDependencies', {
      // These were moved to eslint-config-etherpad's dependencies so they can be removed:
      'ep_etherpad-lite': null,
    });

    /*await updateDeps(parsedPackageJSON, 'peerDependencies', {
      // Some plugins require a newer version of Etherpad so don't overwrite if already set.
      'ep_etherpad-lite': {ver: '>=1.8.6', overwrite: false},
    });*/

    delete parsedPackageJSON.peerDependencies;

    await updateDeps(parsedPackageJSON, 'engines', {
      node: '>=18.0.0',
    });

    if (parsedPackageJSON.eslintConfig != null && autoFix) {
      delete parsedPackageJSON.eslintConfig;
      await writePackageJson(parsedPackageJSON);
    }
    if (files.includes('.eslintrc.js')) {
      const [from, to] = [`${pluginPath}/.eslintrc.js`, `${pluginPath}/.eslintrc.cjs`];
      if (!files.includes('.eslintrc.cjs')) {
        if (autoFix) {
          await fsp.rename(from, to);
        } else {
          logger.warn(`please rename ${from} to ${to}`);
        }
      } else {
        logger.error(`both ${from} and ${to} exist; delete ${from}`);
      }
    } else {
      await checkFile('bin/plugins/lib/eslintrc.cjs', '.eslintrc.cjs', false);
    }

    if (checkEntries(parsedPackageJSON, {
      funding: {
        type: 'individual',
        url: 'https://etherpad.org/',
      },
    })) await writePackageJson(parsedPackageJSON);

    if (parsedPackageJSON.scripts == null) parsedPackageJSON.scripts = {};
    if (checkEntries(parsedPackageJSON.scripts, {
      'lint': 'eslint .',
      'lint:fix': 'eslint --fix .',
    }))
      await writePackageJson(parsedPackageJSON);
  }

  if (!files.includes('pnpm-lock.yaml')) {
    logger.warn('pnpm-lock.yaml not found');
    if (!autoFix) {
      logger.warn('Run pnpm install in the plugin folder and commit the package-lock.json file.');
    } else {
        logger.info('Autofixing missing package-lock.json file');
        try {
          fs.statfsSync(`${pluginPath}/package-lock.json`)
          fs.rmSync(`${pluginPath}/package-lock.json`)
        } catch (e) {
          // Nothing to do
        }
        execSync('pnpm install', {
            cwd: `${pluginPath}/`,
            stdio: 'inherit',
        });
    }
  }

  const fillTemplate = async (templateFilename: string, outputFilename: string) => {
    const contents = (await fsp.readFile(templateFilename, 'utf8'))
        .replace(/\[name of copyright owner\]/g, execSync('git config user.name'))
        .replace(/\[plugin_name\]/g, pluginName)
        .replace(/\[yyyy\]/g, new Date().getFullYear().toString());
    await fsp.writeFile(outputFilename, contents);
  };

  if (!readMeFileName) {
    logger.warn('README.md file not found, please create');
    if (autoFix) {
      logger.info('Autofixing missing README.md file');
      logger.info('please edit the README.md file further to include plugin specific details.');
      await fillTemplate('bin/plugins/lib/README.md', `${pluginPath}/README.md`);
    }
  }

  if (!files.includes('CONTRIBUTING') && !files.includes('CONTRIBUTING.md')) {
    logger.warn('CONTRIBUTING.md file not found, please create');
    if (autoFix) {
      logger.info('Autofixing missing CONTRIBUTING.md file, please edit the CONTRIBUTING.md ' +
                  'file further to include plugin specific details.');
      await fillTemplate('bin/plugins/lib/CONTRIBUTING.md', `${pluginPath}/CONTRIBUTING.md`);
    }
  }


  if (readMeFileName) {
    let readme =
        await fsp.readFile(`${pluginPath}/${readMeFileName}`, {encoding: 'utf8', flag: 'r'});
    if (!readme.toLowerCase().includes('license')) {
      logger.warn('No license section in README');
      if (autoFix) {
        logger.warn('Please add License section to README manually.');
      }
    }
    // eslint-disable-next-line max-len
    const publishBadge = `![Publish Status](https://github.com/ether/${pluginName}/workflows/Node.js%20Package/badge.svg)`;
    // eslint-disable-next-line max-len
    const testBadge = `![Backend Tests Status](https://github.com/ether/${pluginName}/workflows/Backend%20tests/badge.svg)`;
    if (readme.toLowerCase().includes('travis')) {
      logger.warn('Remove Travis badges');
    }
    if (!readme.includes('workflows/Node.js%20Package/badge.svg')) {
      logger.warn('No Github workflow badge detected');
      if (autoFix) {
        readme = `${publishBadge} ${testBadge}\n\n${readme}`;
        // write readme to file system
        await fsp.writeFile(`${pluginPath}/${readMeFileName}`, readme);
        logger.info('Wrote Github workflow badges to README');
      }
    }
  }

  if (!files.includes('LICENSE') && !files.includes('LICENSE.md')) {
    logger.warn('LICENSE file not found, please create');
    if (autoFix) {
      logger.info('Autofixing missing LICENSE file (Apache 2.0).');
      await fsp.copyFile('bin/plugins/lib/LICENSE', `${pluginPath}/LICENSE`);
    }
  }

  if (!files.includes('.gitignore')) {
    logger.warn('.gitignore file not found, please create.  .gitignore files are useful to ' +
                 "ensure files aren't incorrectly commited to a repository.");
    if (autoFix) {
      logger.info('Autofixing missing .gitignore file');
      const gitignore =
          await fsp.readFile('bin/plugins/lib/gitignore', {encoding: 'utf8', flag: 'r'});
      await fsp.writeFile(`${pluginPath}/.gitignore`, gitignore);
    }
  } else {
    let gitignore =
        await fsp.readFile(`${pluginPath}/.gitignore`, {encoding: 'utf8', flag: 'r'});
    if (!gitignore.includes('node_modules/')) {
      logger.warn('node_modules/ missing from .gitignore');
      if (autoFix) {
        gitignore += 'node_modules/';
        await fsp.writeFile(`${pluginPath}/.gitignore`, gitignore);
      }
    }
  }

  // if we include templates but don't have translations...
  if (files.includes('templates') && !files.includes('locales')) {
    logger.warn('Translations not found, please create.  ' +
                 'Translation files help with Etherpad accessibility.');
  }


  if (files.includes('.ep_initialized')) {
    logger.warn(
        '.ep_initialized found, please remove.  .ep_initialized should never be commited to git ' +
        'and should only exist once the plugin has been executed one time.');
    if (autoFix) {
      logger.info('Autofixing incorrectly existing .ep_initialized file');
      await fsp.unlink(`${pluginPath}/.ep_initialized`);
    }
  }

  if (files.includes('npm-debug.log')) {
    logger.warn('npm-debug.log found, please remove.  npm-debug.log should never be commited to ' +
                 'your repository.');
    if (autoFix) {
      logger.info('Autofixing incorrectly existing npm-debug.log file');
      await fsp.unlink(`${pluginPath}/npm-debug.log`);
    }
  }

  if (files.includes('static')) {
    const staticFiles = await fsp.readdir(`${pluginPath}/static`);
    if (!staticFiles.includes('tests')) {
      logger.warn('Test files not found, please create tests.  https://github.com/ether/etherpad-lite/wiki/Creating-a-plugin#writing-and-running-front-end-tests-for-your-plugin');
    }
  } else {
    logger.warn('Test files not found, please create tests.  https://github.com/ether/etherpad-lite/wiki/Creating-a-plugin#writing-and-running-front-end-tests-for-your-plugin');
  }

  // Install dependencies so we can run ESLint. This should also create or update package-lock.json
  // if autoFix is enabled.
  const npmInstall = `pnpm install`;
  execSync(npmInstall, {stdio: 'inherit'});
  // Create the ep_etherpad-lite symlink if necessary. This must be done after running `npm install`
  // because that command nukes the symlink.
  /*try {
    const d = await fsp.realpath(path.join(pluginPath, 'node_modules/ep_etherpad-lite'));
    assert.equal(d, epSrcDir);
  } catch (err) {
    execSync(`${npmInstall} --no-save ep_etherpad-lite@file:${epSrcDir}`, {stdio: 'inherit'});
  }*/
  // linting begins
  try {
    logger.info('Linting...');
    const lintCmd = autoFix ? 'pnpm exec eslint --fix .' : 'npx eslint';
    execSync(lintCmd, {stdio: 'inherit'});
  } catch (e) {
    // it is gonna throw an error anyway
    logger.info('Manual linting probably required, check with: pnpm run lint');
  }
  // linting ends.

  if (autoFix) {
    /*const unchanged = JSON.parse(execSync(
        'untracked=$(git ls-files -o --exclude-standard) || exit 1; ' +
        'git diff-files --quiet && [ -z "$untracked" ] && echo true || echo false'));*/

    if (true) {
      // Display a diff of changes. Git doesn't diff untracked files, so they must be added to the
      // index. Use a temporary index file to avoid modifying Git's default index file.
      execSync('git read-tree HEAD', {
        env: {...process.env, GIT_INDEX_FILE: '.git/checkPlugin.index'},
        stdio: 'inherit',
      });
      execSync('git add -A', {
        env: {...process.env, GIT_INDEX_FILE: '.git/checkPlugin.index'},
        stdio: 'inherit',
      });
      execSync('git diff-index -p --cached HEAD', {
        env: {...process.env, GIT_INDEX_FILE: '.git/checkPlugin.index'},
        stdio: 'inherit',
      });

      await fsp.unlink(`${pluginPath}/.git/checkPlugin.index`);

      const commitCmd = [
        'git add -A',
        'git commit -m "autofixes from Etherpad checkPlugin.js"',
      ]

      if (autoCommit) {
        logger.info('Committing changes...');
        execSync(commitCmd[0], {stdio: 'inherit'});
        execSync(commitCmd[1], {stdio: 'inherit'});
      } else {
        logger.info('Fixes applied. Check the above git diff then run the following command:');
        logger.info(`(cd node_modules/${pluginName} && ${commitCmd.join(' && ')})`);
      }
      const pushCmd = 'git push';
      if (autoPush) {
        logger.info('Pushing new commit...');
        execSync(pushCmd, {stdio: 'inherit'});
      } else {
        logger.info('Changes committed. To push, run the following command:');
        logger.info(`(cd node_modules/${pluginName} && ${pushCmd})`);
      }
    } else {
      logger.info('No changes.');
    }
  }
  logger.info('Finished');
  process.exit(0)
})();
