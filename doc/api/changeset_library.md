# Changeset Library

The [changeset
library](https://github.com/ether/etherpad/blob/develop/src/static/js/Changeset.ts)
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

### Reading a changeset

`unpack()` splits a changeset string into its parts:

```javascript
const unpacked = Changeset.unpack('Z:z>1|2=m=b*0|1+1$\n');
// { oldLen: 35, newLen: 36, ops: '|2=m=b*0|1+1', charBank: '\n' }
```

`oldLen` is the document length before the change and `newLen` the length after.
`ops` is the list of operations, and `charBank` holds the characters inserted by
those operations.

Iterate the operations with `deserializeOps()`, which yields one `Op` at a time:

```javascript
for (const op of Changeset.deserializeOps(unpacked.ops)) {
  console.log(op);
}
// Op { opcode: '=', chars: 22, lines: 2, attribs: '' }
// Op { opcode: '=', chars: 11, lines: 0, attribs: '' }
// Op { opcode: '+', chars: 1,  lines: 1, attribs: '*0' }
```

There are three kinds of operation, each applied starting from the current
position in the text:

- `=` keeps text (it may still change the text's attributes, e.g. make it bold).
- `-` removes text.
- `+` inserts text (taking the characters from the changeset's `charBank`).

`opcode` is the operation type; `chars` and `lines` are how much text it covers;
and `attribs` are the attributes applied, written as `*` references into the
pad's attribute pool. In the example above the final op inserts one character
(the newline from `charBank`) carrying attribute `*0`.

## Attribute Pool

```javascript
const AttributePool = require('ep_etherpad-lite/static/js/AttributePool');
```

Changesets do not include any attribute key–value pairs. Instead, they use
numeric identifiers that reference attributes kept in an [attribute
pool](https://github.com/ether/etherpad/blob/develop/src/static/js/AttributePool.ts).
This attribute interning reduces the transmission overhead of attributes that
are used many times.

There is one attribute pool per pad, and it includes every current and
historical attribute used in the pad.

A pool can be serialized to and from a plain object with `toJsonable()` and
`fromJsonable()`:

```javascript
const pool = new AttributePool();
pool.fromJsonable({
  numToAttrib: {
    0: ['author', 'a.kVnWeomPADAT2pn9'],
    1: ['bold', 'true'],
    2: ['italic', 'true'],
  },
  nextNum: 3,
});

pool.getAttrib(1);      // [ 'bold', 'true' ]
pool.getAttribKey(1);   // 'bold'
pool.getAttribValue(1); // 'true'
```

Each attribute is a `[key, value]` pair — `['bold', 'true']`, or
`['author', '<authorId>']`. A character can carry several attributes (bold *and*
italic), but only one value per key (so it cannot belong to two authors).

## Attributed text (atext)

A pad's content is stored as *attributed text* (`atext`): the plain text plus an
attribute string describing which attributes apply to each span.

```javascript
const atext = {
  text: 'bold text\nitalic text\nnormal text\n\n',
  attribs: '*0*1+9*0|1+1*0*1*2+b|1+1*0+b|2+2',
};
```

The attribute string is a sequence of `+` operations — the same encoding used by
changesets — which you can read with `deserializeOps()`:

```javascript
for (const op of Changeset.deserializeOps(atext.attribs)) {
  console.log(op);
}
// Op { opcode: '+', chars: 9,  lines: 0, attribs: '*0*1' }
// Op { opcode: '+', chars: 1,  lines: 1, attribs: '*0' }
// Op { opcode: '+', chars: 11, lines: 0, attribs: '*0*1*2' }
// Op { opcode: '+', chars: 1,  lines: 1, attribs: '' }
// Op { opcode: '+', chars: 11, lines: 0, attribs: '*0' }
// Op { opcode: '+', chars: 2,  lines: 2, attribs: '' }
```

Read against the pool above, the first nine characters (`bold text`) carry
attributes `*0*1` (author + bold), the following newline carries `*0`, and so on.

## Further Reading

Detailed information about the changesets & Easysync protocol:

* [Easysync Protocol](https://github.com/ether/etherpad/blob/develop/doc/easysync/easysync-notes.pdf)
* [Etherpad and EasySync Technical Manual](https://github.com/ether/etherpad/blob/develop/doc/easysync/easysync-full-description.pdf)
