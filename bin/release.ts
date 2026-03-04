'use strict';

// As of v14, Node.js does not exit when there is an unhandled Promise rejection. Convert an
// unhandled rejection into an uncaught exception, which does cause Node.js to exit.

import process from 'node:process'

process.on('unhandledRejection', (err) => { throw err; });

import fs from 'node:fs';
import childProcess from 'node:child_process';
import log4js from 'log4js';
import path from 'node:path';
import semver from 'semver';
import {exec} from 'node:child_process';

log4js.configure({appenders: {console: {type: 'console'}},
  categories: {
    default: {appenders: ['console'], level: 'info'},
  }});

/*

Usage

node bin/release.js patch

*/
const usage =
    'node bin/release.js [patch/minor/major] -- example: "node bin/release.js patch"';

const release = process.argv[2];

if (!release) {
  console.log(usage);
  throw new Error('No release type included');
}

if (release !== 'patch' && release !== 'minor' && release !== 'major') {
    console.log(usage);
    throw new Error('Invalid release type');
}


const cwd = path.join(fs.realpathSync(__dirname), '../');
process.chdir(cwd);

// Run command capturing stdout. Trailing newlines are stripped (like the shell does).
const runc =
    (cmd:string, opts = {}) => childProcess.execSync(cmd, {encoding: 'utf8', ...opts}).replace(/\n+$/, '').trim();
// Run command without capturing stdout.
const run = (cmd: string, opts = {}) => childProcess.execSync(cmd, {stdio: 'inherit', ...opts});

const readJson = (filename: string) => JSON.parse(fs.readFileSync(filename, {encoding: 'utf8', flag: 'r'}));

const assertWorkDirClean = (opts:{
    cwd?: string;
} = {}) => {
  // Stash any changes in the working directory so that we can check for modifications.
  runc('git stash')
  opts.cwd = runc('git rev-parse --show-cdup', opts) || cwd;
  const m = runc('git diff-files --name-status', opts);
  console.log(">"+m.trim()+"<")
  if (m.length !== 0) {
    throw new Error(`modifications in working directory ${opts.cwd}:\n${m}`);
  }
  const u = runc('git ls-files -o --exclude-standard', opts);
  if (u.length !== 0) {
    throw new Error(`untracked files in working directory ${opts.cwd}:\n${u}`);
  }
  const s = runc('git diff-index --cached --name-status HEAD', opts);
  if (s.length !==0) {
    throw new Error(`uncommitted changes in working directory ${opts.cwd}:\n${s}`);
  }
};

const assertBranchCheckedOut = (branch: string, opts:{
  cwd?: string;
} = {}) => {
  const b = runc('git symbolic-ref HEAD', opts);
  if (b !== `refs/heads/${branch}`) {
    const d = opts.cwd ? path.resolve(cwd, opts.cwd) : cwd;
    throw new Error(`${branch} must be checked out (cwd: ${d})`);
  }
};

const assertUpstreamOk = (branch: string, opts:{
  cwd?: string;
} = {}) => {
  const upstream = runc(`git rev-parse --symbolic-full-name ${branch}@{u}`, opts);
  if (!(new RegExp(`^refs/remotes/[^/]+/${branch}`)).test(upstream)) {
    throw new Error(`${branch} should track origin/${branch}; see git branch --set-upstream-to`);
  }
  try {
    run(`git merge-base --is-ancestor ${branch} ${branch}@{u}`);
  } catch (err:any) {
    if (err.status !== 1) throw err;
    throw new Error(`${branch} is ahead of origin/${branch}; do you need to push?`);
  }
};

// Check if asciidoctor is installed
exec('asciidoctor -v', (err) => {
  if (err) {
    console.log('Please install asciidoctor');
    console.log('https://asciidoctor.org/docs/install-toolchain/');
    process.exit(1);
  }
});

const dirExists = (dir: string) => {
  try {
    return fs.statSync(dir).isDirectory();
  } catch (err:any) {
    if (err.code !== 'ENOENT') throw err;
    return false;
  }
};

// Sanity checks for Etherpad repo.
assertWorkDirClean();
assertBranchCheckedOut('develop');
assertUpstreamOk('develop');
assertUpstreamOk('master');

// Sanity checks for documentation repo.
if (!dirExists('../ether.github.com')) {
  throw new Error('please clone documentation repo: ' +
                  '(cd .. && git clone git@github.com:ether/ether.github.com.git)');
}
assertWorkDirClean({cwd: '../ether.github.com/'});
assertBranchCheckedOut('master', {cwd: '../ether.github.com/'});
assertUpstreamOk('master', {cwd: '../ether.github.com/'});

const changelog = fs.readFileSync('CHANGELOG.md', {encoding: 'utf8', flag: 'r'});
const pkg = readJson('./src/package.json');
const currentVersion = pkg.version;

const newVersion = semver.inc(currentVersion, release);
if (!newVersion) {
  console.log(usage);
  throw new Error('Unable to generate new version from input');
}

if (!changelog.startsWith(`# ${newVersion}\n`)) {
  throw new Error(`No changelog record for ${newVersion}, please create changelog record`);
}

// ////////////////////////////////////////////////////////////////////////////////////////////////
// Done with sanity checks, now it's time to make changes.

try {
  console.log('Updating develop branch...');
  run('git pull --ff-only');

  console.log(`Bumping ${release} version (to ${newVersion})...`);
  pkg.version = newVersion;

  run(`echo "$(jq '. += {"version": "'${newVersion}'"}' src/package.json)" > src/package.json`)
  run(`echo "$(jq '. += {"version": "'${newVersion}'"}' admin/package.json)" > admin/package.json`)
  run(`echo "$(jq '. += {"version": "'${newVersion}'"}' bin/package.json)" > bin/package.json`)
  run(`echo "$(jq '. += {"version": "'${newVersion}'"}' ./package.json)" > ./package.json`)

  // run npm version `release` where release is patch, minor or major
  run('pnpm install');
  // run npm install --package-lock-only <-- required???

  run('git add -A');
  run('git commit -m "bump version"');
  console.log('Switching to master...');
  run('git checkout master');
  console.log('Updating master branch...');
  run('git pull --ff-only');
  console.log('Merging develop into master...');
  run('git merge --no-ff --no-edit develop');
  console.log(`Creating ${newVersion} tag...`);
  run(`git tag -a '${newVersion}' -m '${newVersion}'`);
  run(`git tag -a 'v${newVersion}' -m 'v${newVersion}'`);
  console.log('Switching back to develop...');
  run('git checkout develop');
  console.log('Merging master into develop...');
  run('git merge --no-ff --no-edit master');
} catch (err:any) {
  console.error(err.toString());
  console.warn('Resetting repository...');
  console.warn('Resetting master...');
  run('git checkout -f master');
  run('git reset --hard @{u}');
  console.warn('Resetting develop...');
  run('git checkout -f develop');
  run('git reset --hard @{u}');
  console.warn(`Deleting ${newVersion} tag...`);
  run(`git rev-parse -q --verify refs/tags/'${newVersion}' >/dev/null || exit 0; ` +
      `git tag -d '${newVersion}'`);
  run(`git rev-parse -q --verify refs/tags/'v${newVersion}' >/dev/null || exit 0; ` +
      `git tag -d 'v${newVersion}'`);
  throw err;
}

try {
  console.log('Building documentation...');
  run('pnpm run makeDocs');
  console.log('Updating ether.github.com master branch...');
  run('git pull --ff-only', {cwd: '../ether.github.com/'});
  console.log('Committing documentation...');
  run(`cp -R out/doc/ ../ether.github.com/public/doc/v'${newVersion}'`);
  run(`pnpm version ${newVersion}`, {cwd: '../ether.github.com'});
  run('git add .', {cwd: '../ether.github.com/'});
  run(`git commit -m '${newVersion} docs'`, {cwd: '../ether.github.com/'});
} catch (err:any) {
  console.error(err.toString());
  console.warn('Resetting repository...');
  console.warn('Resetting master...');
  run('git checkout -f master', {cwd: '../ether.github.com/'});
  run('git reset --hard @{u}', {cwd: '../ether.github.com/'});
  throw err;
}

console.log('Done.');
console.log('Review the new commits and the new tag:');
console.log('  git log --graph --date-order --boundary --oneline --decorate develop@{u}..develop');
console.log(`  git show '${newVersion}'`);
console.log('  (cd ../ether.github.com && git show)');
console.log('If everything looks good then push:');
console.log('Run ./bin/push-after-release.sh');
console.log('Creating a Windows build is not necessary anymore and will be created by GitHub action');
console.log('After the windows binary is created a new release with the set version is created automatically.' +
    ' Just paste the release notes in there');
console.log('The docs are updated automatically with the new version. While the windows build' +
    ' is generated people can still download the older versions.');
console.log('Finally go public with an announcement via our comms channels :)');
