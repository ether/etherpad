'use strict';

/*
 * While importexport tests target the `setHTML` API endpoint, which is nearly identical to what
 * happens when a user manually imports a document via the UI, the contentcollector tests here don't
 * use rehype to process the document. Rehype removes spaces and newĺines were applicable, so the
 * expected results here can differ from importexport.js.
 *
 * If you add tests here, please also add them to importexport.js
 */

import {APool} from "../../../node/types/PadType";

import AttributePool from '../../../static/js/AttributePool';
const Changeset = require('../../../static/js/Changeset');
const assert = require('assert').strict;
import attributes from '../../../static/js/attributes';
const contentcollector = require('../../../static/js/contentcollector');
import jsdom from 'jsdom';
import {Attribute} from "../../../static/js/types/Attribute";

// All test case `wantAlines` values must only refer to attributes in this list so that the
// attribute numbers do not change due to changes in pool insertion order.
const knownAttribs: Attribute[] = [
  ['insertorder', 'first'],
  ['italic', 'true'],
  ['list', 'bullet1'],
  ['list', 'bullet2'],
  ['list', 'number1'],
  ['list', 'number2'],
  ['lmkr', '1'],
  ['start', '1'],
  ['start', '2'],
];

const testCases = [
  {
    description: 'Simple',
    html: '<html><body><p>foo</p></body></html>',
    wantAlines: ['+3'],
    wantText: ['foo'],
  },
  {
    description: 'Line starts with asterisk',
    html: '<html><body><p>*foo</p></body></html>',
    wantAlines: ['+4'],
    wantText: ['*foo'],
  },
  {
    description: 'Complex nested Li',
    html: '<!doctype html><html><body><ol><li>one</li><li><ol><li>1.1</li></ol></li><li>two</li></ol></body></html>',
    wantAlines: [
      '*0*4*6*7+1+3',
      '*0*5*6*8+1+3',
      '*0*4*6*8+1+3',
    ],
    wantText: [
      '*one', '*1.1', '*two',
    ],
  },
  {
    description: 'Complex list of different types',
    html: '<!doctype html><html><body><ul class="bullet"><li>one</li><li>two</li><li>0</li><li>1</li><li>2<ul class="bullet"><li>3</li><li>4</li></ul></li></ul><ol class="number"><li>item<ol class="number"><li>item1</li><li>item2</li></ol></li></ol></body></html>',
    wantAlines: [
      '*0*2*6+1+3',
      '*0*2*6+1+3',
      '*0*2*6+1+1',
      '*0*2*6+1+1',
      '*0*2*6+1+1',
      '*0*3*6+1+1',
      '*0*3*6+1+1',
      '*0*4*6*7+1+4',
      '*0*5*6*8+1+5',
      '*0*5*6*8+1+5',
    ],
    wantText: [
      '*one',
      '*two',
      '*0',
      '*1',
      '*2',
      '*3',
      '*4',
      '*item',
      '*item1',
      '*item2',
    ],
  },
  {
    description: 'Tests if uls properly get attributes',
    html: '<html><body><ul><li>a</li><li>b</li></ul><div>div</div><p>foo</p></body></html>',
    wantAlines: [
      '*0*2*6+1+1',
      '*0*2*6+1+1',
      '+3',
      '+3',
    ],
    wantText: ['*a', '*b', 'div', 'foo'],
  },
  {
    description: 'Tests if indented uls properly get attributes',
    html: '<html><body><ul><li>a</li><ul><li>b</li></ul><li>a</li></ul><p>foo</p></body></html>',
    wantAlines: [
      '*0*2*6+1+1',
      '*0*3*6+1+1',
      '*0*2*6+1+1',
      '+3',
    ],
    wantText: ['*a', '*b', '*a', 'foo'],
  },
  {
    description: 'Tests if ols properly get line numbers when in a normal OL',
    html: '<html><body><ol><li>a</li><li>b</li><li>c</li></ol><p>test</p></body></html>',
    wantAlines: [
      '*0*4*6*7+1+1',
      '*0*4*6*7+1+1',
      '*0*4*6*7+1+1',
      '+4',
    ],
    wantText: ['*a', '*b', '*c', 'test'],
    noteToSelf: 'Ensure empty P does not induce line attribute marker, wont this break the editor?',
  },
  {
    description: 'A single completely empty line break within an ol should reset count if OL is closed off..',
    html: '<html><body><ol><li>should be 1</li></ol><p>hello</p><ol><li>should be 1</li><li>should be 2</li></ol><p></p></body></html>',
    wantAlines: [
      '*0*4*6*7+1+b',
      '+5',
      '*0*4*6*8+1+b',
      '*0*4*6*8+1+b',
      '',
    ],
    wantText: ['*should be 1', 'hello', '*should be 1', '*should be 2', ''],
    noteToSelf: "Shouldn't include attribute marker in the <p> line",
  },
  {
    description: 'A single <p></p> should create a new line',
    html: '<html><body><p></p><p></p></body></html>',
    wantAlines: ['', ''],
    wantText: ['', ''],
    noteToSelf: '<p></p>should create a line break but not break numbering',
  },
  {
    description: 'Tests if ols properly get line numbers when in a normal OL #2',
    html: '<html><body>a<ol><li>b<ol><li>c</li></ol></ol>notlist<p>foo</p></body></html>',
    wantAlines: [
      '+1',
      '*0*4*6*7+1+1',
      '*0*5*6*8+1+1',
      '+7',
      '+3',
    ],
    wantText: ['a', '*b', '*c', 'notlist', 'foo'],
    noteToSelf: 'Ensure empty P does not induce line attribute marker, wont this break the editor?',
  },
  {
    description: 'First item being an UL then subsequent being OL will fail',
    html: '<html><body><ul><li>a<ol><li>b</li><li>c</li></ol></li></ul></body></html>',
    wantAlines: ['+1', '*0*1*2*3+1+1', '*0*4*2*5+1+1'],
    wantText: ['a', '*b', '*c'],
    noteToSelf: 'Ensure empty P does not induce line attribute marker, wont this break the editor?',
    disabled: true,
  },
  {
    description: 'A single completely empty line break within an ol should NOT reset count',
    html: '<html><body><ol><li>should be 1</li><p></p><li>should be 2</li><li>should be 3</li></ol><p></p></body></html>',
    wantAlines: [],
    wantText: ['*should be 1', '*should be 2', '*should be 3'],
    noteToSelf: "<p></p>should create a line break but not break numbering -- This is what I can't get working!",
    disabled: true,
  },
  {
    description: 'Content outside body should be ignored',
    html: '<html><head><title>title</title><style></style></head><body>empty<br></body></html>',
    wantAlines: ['+5'],
    wantText: ['empty'],
  },
  {
    description: 'Multiple spaces should be preserved',
    html: '<html><body>Text with  more   than    one space.<br></body></html>',
    wantAlines: ['+10'],
    wantText: ['Text with  more   than    one space.'],
  },
  {
    description: 'non-breaking and normal space should be preserved',
    html: '<html><body>Text&nbsp;with&nbsp; more&nbsp;&nbsp;&nbsp;than   &nbsp;one space.<br></body></html>',
    wantAlines: ['+10'],
    wantText: ['Text with  more   than    one space.'],
  },
  {
    description: 'Multiple nbsp should be preserved',
    html: '<html><body>&nbsp;&nbsp;<br></body></html>',
    wantAlines: ['+2'],
    wantText: ['  '],
  },
  {
    description: 'Multiple nbsp between words ',
    html: '<html><body>&nbsp;&nbsp;word1&nbsp;&nbsp;word2&nbsp;&nbsp;&nbsp;word3<br></body></html>',
    wantAlines: ['+m'],
    wantText: ['  word1  word2   word3'],
  },
  {
    description: 'A non-breaking space preceded by a normal space',
    html: '<html><body> &nbsp;word1 &nbsp;word2 &nbsp;word3<br></body></html>',
    wantAlines: ['+l'],
    wantText: ['  word1  word2  word3'],
  },
  {
    description: 'A non-breaking space followed by a normal space',
    html: '<html><body>&nbsp; word1&nbsp; word2&nbsp; word3<br></body></html>',
    wantAlines: ['+l'],
    wantText: ['  word1  word2  word3'],
  },
  {
    description: 'Don\'t collapse spaces that follow a newline',
    html: '<!doctype html><html><body>something<br>             something<br></body></html>',
    wantAlines: ['+9', '+m'],
    wantText: ['something', '             something'],
  },
  {
    description: 'Don\'t collapse spaces that follow a empty paragraph',
    html: '<!doctype html><html><body>something<p></p>             something<br></body></html>',
    wantAlines: ['+9', '', '+m'],
    wantText: ['something', '', '             something'],
  },
  {
    description: 'Don\'t collapse spaces that preceed/follow a newline',
    html: '<html><body>something            <br>             something<br></body></html>',
    wantAlines: ['+l', '+m'],
    wantText: ['something            ', '             something'],
  },
  {
    description: 'Don\'t collapse spaces that preceed/follow a empty paragraph',
    html: '<html><body>something            <p></p>             something<br></body></html>',
    wantAlines: ['+l', '', '+m'],
    wantText: ['something            ', '', '             something'],
  },
  {
    description: 'Don\'t collapse non-breaking spaces that follow a newline',
    html: '<html><body>something<br>&nbsp;&nbsp;&nbsp;something<br></body></html>',
    wantAlines: ['+9', '+c'],
    wantText: ['something', '   something'],
  },
  {
    description: 'Don\'t collapse non-breaking spaces that follow a paragraph',
    html: '<html><body>something<p></p>&nbsp;&nbsp;&nbsp;something<br></body></html>',
    wantAlines: ['+9', '', '+c'],
    wantText: ['something', '', '   something'],
  },
  {
    description: 'Preserve all spaces when multiple are present',
    html: '<html><body>Need <span> more </span> space<i>  s </i> !<br></body></html>',
    wantAlines: ['+h*1+4+2'],
    wantText: ['Need  more  space  s  !'],
  },
  {
    description: 'Newlines and multiple spaces across newlines should be preserved',
    html: `
      <html><body>Need
          <span> more </span>
          space
          <i>  s </i>
          !<br></body></html>`,
    wantAlines: ['+19*1+4+b'],
    wantText: ['Need           more           space            s           !'],
  },
  {
    description: 'Multiple new lines at the beginning should be preserved',
    html: '<html><body><br><br><p></p><p></p>first line<br><br>second line<br></body></html>',
    wantAlines: ['', '', '', '', '+a', '', '+b'],
    wantText: ['', '', '', '', 'first line', '', 'second line'],
  },
  {
    description: 'A paragraph with multiple lines should not loose spaces when lines are combined',
    html: `<html><body><p>
а б в г ґ д е є ж з и і ї й к л м н о
п р с т у ф х ц ч ш щ ю я ь</p>
</body></html>`,
    wantAlines: ['+1t'],
    wantText: ['а б в г ґ д е є ж з и і ї й к л м н о п р с т у ф х ц ч ш щ ю я ь'],
  },
  {
    description: 'lines in preformatted text should be kept intact',
    html: `<html><body><p>
а б в г ґ д е є ж з и і ї й к л м н о</p><pre>multiple
lines
in
pre
</pre><p>п р с т у ф х ц ч ш щ ю я
ь</p>
</body></html>`,
    wantAlines: ['+11', '+8', '+5', '+2', '+3', '+r'],
    wantText: [
      'а б в г ґ д е є ж з и і ї й к л м н о',
      'multiple',
      'lines',
      'in',
      'pre',
      'п р с т у ф х ц ч ш щ ю я ь',
    ],
  },
  {
    description: 'pre should be on a new line not preceded by a space',
    html: `<html><body><p>
    1
</p><pre>preline
</pre></body></html>`,
    wantAlines: ['+6', '+7'],
    wantText: ['    1 ', 'preline'],
  },
  {
    description: 'Preserve spaces on the beginning and end of a element',
    html: '<html><body>Need<span> more </span>space<i> s </i>!<br></body></html>',
    wantAlines: ['+f*1+3+1'],
    wantText: ['Need more space s !'],
  },
  {
    description: 'Preserve spaces outside elements',
    html: '<html><body>Need <span>more</span> space <i>s</i> !<br></body></html>',
    wantAlines: ['+g*1+1+2'],
    wantText: ['Need more space s !'],
  },
  {
    description: 'Preserve spaces at the end of an element',
    html: '<html><body>Need <span>more </span>space <i>s </i>!<br></body></html>',
    wantAlines: ['+g*1+2+1'],
    wantText: ['Need more space s !'],
  },
  {
    description: 'Preserve spaces at the start of an element',
    html: '<html><body>Need<span> more</span> space<i> s</i> !<br></body></html>',
    wantAlines: ['+f*1+2+2'],
    wantText: ['Need more space s !'],
  },
];

describe(__filename, function () {
  for (const tc of testCases) {
    describe(tc.description, function () {
      let apool: AttributePool;
      let result: {
        lines: string[],
        lineAttribs: string[],
      };

      before(async function () {
        if (tc.disabled) return this.skip();
        const {window: {document}} = new jsdom.JSDOM(tc.html);
        apool = new AttributePool();
        // To reduce test fragility, the attribute pool is seeded with `knownAttribs`, and all
        // attributes in `tc.wantAlines` must be in `knownAttribs`. (This guarantees that attribute
        // numbers do not change if the attribute processing code changes.)
        for (const attrib of knownAttribs) apool.putAttrib(attrib);
        for (const aline of tc.wantAlines) {
          for (const op of Changeset.deserializeOps(aline)) {
            for (const n of attributes.decodeAttribString(op.attribs)) {
              assert(n < knownAttribs.length);
            }
          }
        }
        const cc = contentcollector.makeContentCollector(true, null, apool);
        cc.collectContent(document.body);
        result = cc.finish();
      });

      it('text matches', async function () {
        assert.deepEqual(result.lines, tc.wantText);
      });

      it('alines match', async function () {
        assert.deepEqual(result.lineAttribs, tc.wantAlines);
      });

      it('attributes are sorted in canonical order', async function () {
        const gotAttribs:string[][][] = [];
        const wantAttribs = [];
        for (const aline of result.lineAttribs) {
          const gotAlineAttribs:string[][] = [];
          gotAttribs.push(gotAlineAttribs);
          const wantAlineAttribs:Attribute[] = [];
          wantAttribs.push(wantAlineAttribs);
          for (const op of Changeset.deserializeOps(aline)) {
            const gotOpAttribs = [...attributes.attribsFromString(op.attribs, apool)] as unknown as Attribute;
            gotAlineAttribs.push(gotOpAttribs);
            // @ts-ignore
            wantAlineAttribs.push(attributes.sort([...gotOpAttribs]));
          }
        }
        assert.deepEqual(gotAttribs, wantAttribs);
      });
    });
  }
});
