# ep_layout_trip_wire

Test fixture for the Debian package CI. Not published, not loaded by
any production Etherpad install.

Exists to catch regressions in the packaging layout. When the `.deb`
postinstall symlinked `/opt/etherpad/src/plugin_packages` outside the
etherpad tree, Node.js resolved the symlink to its realpath before
walking `node_modules` and every `require('ep_etherpad-lite/...')` in
admin-installed plugins threw `MODULE_NOT_FOUND` (see
[ether/ep_comments_page#416](https://github.com/ether/ep_comments_page/issues/416)).

`packaging/test-local.sh` and `.github/workflows/deb-package.yml` stage
this plugin into `/opt/etherpad/src/plugin_packages/.versions/...`,
start etherpad, and grep `journalctl` for the marker emitted from
`expressCreateServer`. If any of the `require('ep_etherpad-lite/...')`
calls in `index.js` fail, the marker never appears and the test fails.
