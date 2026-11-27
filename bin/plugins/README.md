The files in this folder are for Plugin developers.

# Get suggestions to improve your Plugin

This code will check your plugin for known usual issues and some suggestions for
improvements. No changes will be made to your project.

```
node src/bin/plugins/checkPlugin.js $PLUGIN_NAME$
```

# Basic Example:

```
node src/bin/plugins/checkPlugin.js ep_webrtc
```

## Autofixing - will autofix any issues it can

```
node src/bin/plugins/checkPlugin.js ep_whatever autofix
```

## Autocommitting - fix issues and commit

```
node src/bin/plugins/checkPlugin.js ep_whatever autocommit
```

## Autopush - fix issues, commit, push, and publish (highly dangerous)

```
node src/bin/plugins/checkPlugin.js ep_whatever autopush
```

# All the plugins

Replace johnmclear with your github username

```
# Clones
cd node_modules
GHUSER=johnmclear; curl "https://api.github.com/users/$GHUSER/repos?per_page=1000" | grep -o 'git@[^"]*' | grep /ep_ | xargs -L1 git clone
cd ..

# autofixes and autocommits /pushes & npm publishes
for dir in node_modules/ep_*; do
  dir=${dir#node_modules/}
  [ "$dir" != ep_etherpad-lite ] || continue
  node src/bin/plugins/checkPlugin.js "$dir" autocommit
done
```

# Automating update of ether organization plugins

The `update-plugins` GitHub workflow (`.github/workflows/update-plugins.yml`)
runs `checkPlugin <plugin> autopush` daily for every non-archived `ether/ep_*`
repo, which copies the workflow templates in `lib/` into each plugin. The job
fails, with a list of the failed plugins in the run summary, if any plugin
cannot be cloned, pulled or checked. Run it manually with `dry_run` ticked to
see the changes without pushing anything.

A plugin that needs its own copy of a template file (for example a
`frontend-tests.yml` that runs `bin/run-frontend-tests-with-disables.sh`) is
listed in `KEEP_FILES` in `checkPlugin.ts`, and checkPlugin leaves that file
alone. Plugins whose `ep.json` declares `disables` keep their
`frontend-tests.yml` automatically. Repos the workflow skips entirely are
listed in `SKIP_REPOS` in the workflow.

checkPlugin does not bump the plugin version; the plugin's `npmpublish.yml`
does that when the push lands.

```
getCorePlugins.sh
updateCorePlugins.sh
```
