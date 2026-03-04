# Plugin Framework

`require("ep_etherpad-lite/static/js/plugingfw/plugins")`

## plugins.update

`require("ep_etherpad-lite/static/js/plugingfw/plugins").update()` will use npm
to list all installed modules and read their ep.json files, registering the
contained hooks. A hook registration is a pair of a hook name and a function
reference (filename for require() plus function name)

## hooks.callAll

`require("ep_etherpad-lite/static/js/plugingfw/hooks").callAll("hook_name",
{argname:value})` will call all hook functions registered for `hook_name` with
`{argname:value}`.

## hooks.aCallAll

?

## ...
