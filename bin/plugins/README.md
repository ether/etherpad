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

```
getCorePlugins.sh
updateCorePlugins.sh
```
