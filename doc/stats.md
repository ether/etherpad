# Statistics
Etherpad keeps track of the goings-on inside the edit machinery. If you'd like to have a look at this, just point your browser to `/stats`.

We currently measure:

- totalUsers (counter)
- connects (meter)
- disconnects (meter)
- pendingEdits (counter)
- edits (timer)
- failedChangesets (meter)
- httpRequests (timer)
- http500 (meter)
- memoryUsage (gauge)

Under the hood, we are happy to rely on [measured](https://github.com/felixge/node-measured) for all our metrics needs.

To modify or simply access our stats in your plugin, simply `require('ep_etherpad-lite/stats')` which is a [`measured.Collection`](https://yaorg.github.io/node-measured/packages/measured-core/Collection.html).
