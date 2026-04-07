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

Trusted publishing has to be enabled **once per package** on npmjs.com — there
is no API for it. For each package (`ep_etherpad`, every `ep_*` plugin):

1. Sign in to npmjs.com as a maintainer of the package.
2. Open `https://www.npmjs.com/package/<name>/access`.
3. Scroll to **Trusted Publisher** and click **Add trusted publisher**.
4. Fill in:
   - **Publisher**: GitHub Actions
   - **Organization or user**: `ether`
   - **Repository**: the plugin repo (e.g. `ep_align`) — for `ep_etherpad`
     use `etherpad-lite`
   - **Workflow filename**: `.github/workflows/test-and-release.yml` for
     plugins, `.github/workflows/releaseEtherpad.yml` for core
   - **Environment name**: leave blank
5. Click **Add**.

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

- **Node.js**: >= 22.14.0 on the runner (for the npm CLI bundled with it).
- **npm CLI**: >= 11.5.1. The publish workflow installs the latest npm before
  running `npm publish`.
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
