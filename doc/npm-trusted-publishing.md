# npm Trusted Publishing (OIDC)

Etherpad and every `ether/ep_*` plugin publish to npm using
[npm Trusted Publishing][npm-tp] over OpenID Connect. This eliminates the need
to store, rotate, or accidentally leak long-lived `NPM_TOKEN` secrets — each
publish is authenticated against the GitHub Actions runner with a short-lived
OIDC token instead.

[npm-tp]: https://docs.npmjs.com/trusted-publishers

## How it works

1. The publish workflow declares `permissions: id-token: write`.
2. GitHub Actions issues a signed OIDC token to the runner.
3. The npm CLI (>= 11.5.1) trades that OIDC token for a short-lived publish
   credential against npmjs.com.
4. npmjs.com checks the OIDC claims (org, repo, workflow file, branch /
   environment) against the package's configured *trusted publisher* and, if
   they match, accepts the publish. Provenance attestations are recorded
   automatically.

No `NPM_TOKEN` secret is needed in any plugin or in core.

## One-time setup per package

Trusted publishing has to be enabled **once per package**. Use the bundled
script to do every package in one go via the `npm trust` CLI (npm >= 11.5.1):

```sh
# 1. Make sure npm CLI is recent enough
npm install -g npm@latest

# 2. Log in to npmjs.com as a maintainer
npm login

# 3. Bulk-configure every ether/ep_* plugin + ep_etherpad
bin/setup-trusted-publishers.sh

# Or preview without changing anything
bin/setup-trusted-publishers.sh --dry-run

# Or target a specific subset
bin/setup-trusted-publishers.sh --packages ep_align,ep_webrtc

# Or ignore packages that are already configured (the registry only allows
# one trust relationship per package today)
bin/setup-trusted-publishers.sh --skip-existing
```

The script discovers all non-archived `ether/ep_*` repos via `gh repo list`
and runs `npm trust github <pkg> --repository <org>/<repo> --file <workflow>
--yes` for each one. `ep_etherpad` is mapped to the `etherpad-lite` repo and
the `releaseEtherpad.yml` workflow; everything else is mapped to its
same-named repo and `test-and-release.yml`.

If you'd rather click through the npmjs.com UI for a single package: open
`https://www.npmjs.com/package/<name>/access` → **Trusted Publisher** →
**Add trusted publisher** → Publisher: GitHub Actions, Organization: `ether`,
Repository: as above, Workflow filename: as above, Environment: blank.

Once added, the next push to `main`/`master` will publish via OIDC with no
token at all.

## Migrating an existing package

If a package previously had an `NPM_TOKEN` secret in CI:

1. Add the trusted publisher on npmjs.com (steps above).
2. Bump the workflow to the OIDC version — done in
   `bin/plugins/lib/npmpublish.yml` (which is propagated to every plugin by
   the `update-plugins` workflow).
3. Remove the now-unused `NPM_TOKEN` secret from the GitHub repo settings.

## Requirements

- **Node.js**: >= 20.17.0 on the runner. npm 11 requires
  `^20.17.0 || >=22.9.0`. The npm docs nominally recommend Node 22.14+, but
  Node 20.17+ works fine — the project's `engines.node` already requires
  `>=20.0.0`, and `setup-node@v6 with version: 20` resolves to the latest 20.x.
- **npm CLI**: >= 11.5.1. The publish workflow runs `npm install -g npm@latest`
  before publishing so the bundled npm version doesn't matter.
- **Runner**: must be a GitHub-hosted (cloud) runner. Self-hosted runners are
  not yet supported by npm trusted publishing.
- **`package.json`**: must declare a `repository` field pointing at the
  GitHub repo so npm can verify the OIDC claim. Example:

  ```json
  {
    "repository": {
      "type": "git",
      "url": "https://github.com/ether/ep_align.git"
    }
  }
  ```

## Why call `npm publish` directly?

The publish workflows run `npm publish --provenance --access public` rather
than `pnpm publish` or `gnpm publish`. Both wrappers shell out to whichever
`npm` is on `PATH`, but they obscure version requirements: trusted publishing
requires npm >= 11.5.1, and going through the wrapper makes it easy to end up
with the wrong CLI version. Invoking `npm` directly removes that ambiguity.

`pnpm` is still used for everything else (install, build, version bump) — only
the final publish step calls `npm` directly.

## Troubleshooting

**`npm error 404 Not Found - PUT https://registry.npmjs.org/<pkg>`**

The trusted publisher hasn't been configured on npmjs.com for that package, or
the repository / workflow filename in the trusted publisher config doesn't
match the running workflow. Double-check the workflow filename — it must be the
*basename* of the workflow YAML, not the job name.

**`npm error code E_OIDC_NO_TOKEN`**

The workflow is missing `permissions: id-token: write`. Add it to the job
(or to the top-level `permissions:` block).

**`npm error need: 11.5.1`**

The runner is using an older bundled npm. The workflow runs
`npm install -g npm@latest` to fix this — make sure that step ran before the
publish step.
