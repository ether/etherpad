# Changeset Library

The [changeset
library](https://github.com/ether/etherpad-lite/blob/develop/src/static/js/Changeset.ts)
provides tools to create, read, and apply changesets.

## Changeset

```javascript
const Changeset = require('ep_etherpad-lite/static/js/Changeset');
```

A changeset describes the difference between two revisions of a document. When a
user edits a pad, the browser generates and sends a changeset to the server,
which relays it to the other users and saves a copy (so that every past revision
is accessible).

A transmitted changeset looks like this:

```
'Z:z>1|2=m=b*0|1+1$\n'
```

## Attribute Pool

```javascript
const AttributePool = require('ep_etherpad-lite/static/js/AttributePool');
```

Changesets do not include any attribute key–value pairs. Instead, they use
numeric identifiers that reference attributes kept in an [attribute
pool](https://github.com/ether/etherpad-lite/blob/develop/src/static/js/AttributePool.ts).
This attribute interning reduces the transmission overhead of attributes that
are used many times.

There is one attribute pool per pad, and it includes every current and
historical attribute used in the pad.

## Further Reading

Detailed information about the changesets & Easysync protocol:

* [Easysync Protocol](https://github.com/ether/etherpad-lite/blob/develop/doc/easysync/easysync-notes.pdf)
* [Etherpad and EasySync Technical Manual](https://github.com/ether/etherpad-lite/blob/develop/doc/easysync/easysync-full-description.pdf)
