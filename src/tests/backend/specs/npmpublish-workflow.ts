'use strict';

// Regression test for bin/plugins/lib/npmpublish.yml.
//
// This file is the source-of-truth template that `bin/plugins/checkPlugin.ts`
// propagates into every `ether/ep_*` plugin's `.github/workflows/`. The
// version-bump step in it MUST use `git push --atomic` rather than the older
// `git push --follow-tags`, otherwise concurrent publish runs can leave
// dangling `vN+1` tags on plugin repos with no matching version-bump commit —
// at which point every subsequent push fails forever with
// `npm error fatal: tag 'vN+1' already exists` until someone reconciles the
// repo by hand.
//
// On 2026-04-08 a single churn day produced ~46 broken plugins this way; the
// recovery was painful enough to be worth a regression test.

import {strict as assert} from 'assert';
import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const NPMPUBLISH_YML = path.join(REPO_ROOT, 'bin', 'plugins', 'lib', 'npmpublish.yml');

describe(__filename, function () {
  let yml: string;

  before(function () {
    yml = fs.readFileSync(NPMPUBLISH_YML, 'utf8');
  });

  it('uses git push --atomic for the version bump', function () {
    assert.match(
      yml, /git push --atomic\b/,
      'npmpublish.yml must use `git push --atomic` so the branch update and ' +
      'the tag push happen as a single transaction. Without --atomic, a ' +
      'rejected branch fast-forward (e.g. lost race against a concurrent ' +
      'publish run) can still leave the tag pushed, producing a dangling ' +
      'vN+1 tag and breaking every future publish on the plugin.',
    );
  });

  it('does not regress to `git push --follow-tags`', function () {
    // Strip YAML comments before checking — the historical bug is described
    // in a comment block above the new code, and that's an intentional
    // forensic note, not a regression. We only care if the actual command
    // line uses --follow-tags.
    const commandLines = yml
      .split('\n')
      .filter((l) => !/^\s*#/.test(l))
      .join('\n');
    assert.doesNotMatch(
      commandLines, /git push --follow-tags\b/,
      '`git push --follow-tags` is non-atomic per ref and is the exact ' +
      'failure mode this workflow used to have. Use `git push --atomic ' +
      'origin <branch> <tag>` instead.',
    );
  });

  it('pushes both the branch ref and the version tag in the atomic command', function () {
    // Find the atomic push line and assert it carries at least two refspecs
    // (the branch + the tag). We don't pin the exact variable names — just
    // require that the line names something tag-shaped and something
    // branch-shaped — but we DO require the new tag to be derived from the
    // freshly-bumped package.json so it can't drift from what `pnpm version
    // patch` actually wrote.
    const lines = yml.split('\n');
    const pushLine = lines.find((l) => /git push --atomic\b/.test(l));
    assert.ok(pushLine, 'expected to find a `git push --atomic` line');
    // Branch ref — workflow_call inherits the caller's ref via GITHUB_REF_NAME.
    assert.match(
      pushLine!, /\$\{?GITHUB_REF_NAME\}?/,
      'atomic push must include the branch ref via $GITHUB_REF_NAME so it ' +
      'works for both `main`- and `master`-default plugins',
    );
    // Tag ref — must reference the variable holding the just-bumped tag.
    assert.match(
      pushLine!, /\$\{?NEW_TAG\}?|\$\{?TAG\}?/,
      'atomic push must include the version tag (NEW_TAG / TAG) it just created',
    );
  });
});
