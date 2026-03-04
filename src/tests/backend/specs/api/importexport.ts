'use strict';
/*
 * ACHTUNG: there is a copied & modified version of this file in
 * <basedir>/src/tests/container/spacs/api/pad.js
 *
 * TODO: unify those two files, and merge in a single one.
 */

import { strict as assert } from 'assert';
import {MapArrayType} from "../../../../node/types/MapType";
const common = require('../../common');

let agent:any;
const apiVersion = 1;

const endPoint = (point: string, version?:string) => `/api/${version || apiVersion}/${point}`;

const testImports:MapArrayType<any> = {
  'malformed': {
    input: '<html><body><li>wtf</ul></body></html>',
    wantHTML: '<!DOCTYPE HTML><html><body>wtf<br><br></body></html>',
    wantText: 'wtf\n\n',
    disabled: true,
  },
  'nonelistiteminlist #3620': {
    input: '<html><body><ul>test<li>FOO</li></ul></body></html>',
    wantHTML: '<!DOCTYPE HTML><html><body><ul class="bullet">test<li>FOO</ul><br></body></html>',
    wantText: '\ttest\n\t* FOO\n\n',
    disabled: true,
  },
  'whitespaceinlist #3620': {
    input: '<html><body><ul> <li>FOO</li></ul></body></html>',
    wantHTML: '<!DOCTYPE HTML><html><body><ul class="bullet"><li>FOO</ul><br></body></html>',
    wantText: '\t* FOO\n\n',
  },
  'prefixcorrectlinenumber': {
    input: '<html><body><ol><li>should be 1</li><li>should be 2</li></ol></body></html>',
    wantHTML: '<!DOCTYPE HTML><html><body><ol start="1" class="number"><li>should be 1</li><li>should be 2</ol><br></body></html>',
    wantText: '\t1. should be 1\n\t2. should be 2\n\n',
  },
  'prefixcorrectlinenumbernested': {
    input: '<html><body><ol><li>should be 1</li><ol><li>foo</li></ol><li>should be 2</li></ol></body></html>',
    wantHTML: '<!DOCTYPE HTML><html><body><ol start="1" class="number"><li>should be 1<ol start="2" class="number"><li>foo</ol><li>should be 2</ol><br></body></html>',
    wantText: '\t1. should be 1\n\t\t1.1. foo\n\t2. should be 2\n\n',
  },

  /*
  "prefixcorrectlinenumber when introduced none list item - currently not supported see #3450": {
    input: '<html><body><ol><li>should be 1</li>test<li>should be 2</li></ol></body></html>',
    wantHTML: '<!DOCTYPE HTML><html><body><ol start="1" class="number"><li>should be 1</li>test<li>should be 2</li></ol><br></body></html>',
    wantText: '\t1. should be 1\n\ttest\n\t2. should be 2\n\n',
  }
  ,
  "newlinesshouldntresetlinenumber #2194": {
    input: '<html><body><ol><li>should be 1</li>test<li>should be 2</li></ol></body></html>',
    wantHTML: '<!DOCTYPE HTML><html><body><ol class="number"><li>should be 1</li>test<li>should be 2</li></ol><br></body></html>',
    wantText: '\t1. should be 1\n\ttest\n\t2. should be 2\n\n',
  }
  */
  'ignoreAnyTagsOutsideBody': {
    description: 'Content outside body should be ignored',
    input: '<html><head><title>title</title><style></style></head><body>empty<br></body></html>',
    wantHTML: '<!DOCTYPE HTML><html><body>empty<br><br></body></html>',
    wantText: 'empty\n\n',
  },
  'indentedListsAreNotBullets': {
    description: 'Indented lists are represented with tabs and without bullets',
    input: '<html><body><ul class="indent"><li>indent</li><li>indent</ul></body></html>',
    wantHTML: '<!DOCTYPE HTML><html><body><ul class="indent"><li>indent</li><li>indent</ul><br></body></html>',
    wantText: '\tindent\n\tindent\n\n',
  },
  'lineWithMultipleSpaces': {
    description: 'Multiple spaces should be collapsed',
    input: '<html><body>Text with  more   than    one space.<br></body></html>',
    wantHTML: '<!DOCTYPE HTML><html><body>Text with more than one space.<br><br></body></html>',
    wantText: 'Text with more than one space.\n\n',
  },
  'lineWithMultipleNonBreakingAndNormalSpaces': {
    // XXX the HTML between "than" and "one" looks strange
    description: 'non-breaking space should be preserved, but can be replaced when it',
    input: '<html><body>Text&nbsp;with&nbsp; more&nbsp;&nbsp;&nbsp;than   &nbsp;one space.<br></body></html>',
    wantHTML: '<!DOCTYPE HTML><html><body>Text with&nbsp; more&nbsp;&nbsp; than&nbsp; one space.<br><br></body></html>',
    wantText: 'Text with  more   than  one space.\n\n',
  },
  'multiplenbsp': {
    description: 'Multiple non-breaking space should be preserved',
    input: '<html><body>&nbsp;&nbsp;<br></body></html>',
    wantHTML: '<!DOCTYPE HTML><html><body>&nbsp;&nbsp;<br><br></body></html>',
    wantText: '  \n\n',
  },
  'multipleNonBreakingSpaceBetweenWords': {
    description: 'A normal space is always inserted before a word',
    input: '<html><body>&nbsp;&nbsp;word1&nbsp;&nbsp;word2&nbsp;&nbsp;&nbsp;word3<br></body></html>',
    wantHTML: '<!DOCTYPE HTML><html><body>&nbsp; word1&nbsp; word2&nbsp;&nbsp; word3<br><br></body></html>',
    wantText: '  word1  word2   word3\n\n',
  },
  'nonBreakingSpacePreceededBySpaceBetweenWords': {
    description: 'A non-breaking space preceded by a normal space',
    input: '<html><body> &nbsp;word1 &nbsp;word2 &nbsp;word3<br></body></html>',
    wantHTML: '<!DOCTYPE HTML><html><body>&nbsp;word1&nbsp; word2&nbsp; word3<br><br></body></html>',
    wantText: ' word1  word2  word3\n\n',
  },
  'nonBreakingSpaceFollowededBySpaceBetweenWords': {
    description: 'A non-breaking space followed by a normal space',
    input: '<html><body>&nbsp; word1&nbsp; word2&nbsp; word3<br></body></html>',
    wantHTML: '<!DOCTYPE HTML><html><body>&nbsp; word1&nbsp; word2&nbsp; word3<br><br></body></html>',
    wantText: '  word1  word2  word3\n\n',
  },
  'spacesAfterNewline': {
    description: 'Collapse spaces that follow a newline',
    input: '<!doctype html><html><body>something<br>             something<br></body></html>',
    wantHTML: '<!DOCTYPE HTML><html><body>something<br>something<br><br></body></html>',
    wantText: 'something\nsomething\n\n',
  },
  'spacesAfterNewlineP': {
    description: 'Collapse spaces that follow a paragraph',
    input: '<!doctype html><html><body>something<p></p>             something<br></body></html>',
    wantHTML: '<!DOCTYPE HTML><html><body>something<br><br>something<br><br></body></html>',
    wantText: 'something\n\nsomething\n\n',
  },
  'spacesAtEndOfLine': {
    description: 'Collapse spaces that preceed/follow a newline',
    input: '<html><body>something            <br>             something<br></body></html>',
    wantHTML: '<!DOCTYPE HTML><html><body>something<br>something<br><br></body></html>',
    wantText: 'something\nsomething\n\n',
  },
  'spacesAtEndOfLineP': {
    description: 'Collapse spaces that preceed/follow a paragraph',
    input: '<html><body>something            <p></p>             something<br></body></html>',
    wantHTML: '<!DOCTYPE HTML><html><body>something<br><br>something<br><br></body></html>',
    wantText: 'something\n\nsomething\n\n',
  },
  'nonBreakingSpacesAfterNewlines': {
    description: 'Don\'t collapse non-breaking spaces that follow a newline',
    input: '<html><body>something<br>&nbsp;&nbsp;&nbsp;something<br></body></html>',
    wantHTML: '<!DOCTYPE HTML><html><body>something<br>&nbsp;&nbsp; something<br><br></body></html>',
    wantText: 'something\n   something\n\n',
  },
  'nonBreakingSpacesAfterNewlinesP': {
    description: 'Don\'t collapse non-breaking spaces that follow a paragraph',
    input: '<html><body>something<p></p>&nbsp;&nbsp;&nbsp;something<br></body></html>',
    wantHTML: '<!DOCTYPE HTML><html><body>something<br><br>&nbsp;&nbsp; something<br><br></body></html>',
    wantText: 'something\n\n   something\n\n',
  },
  'collapseSpacesInsideElements': {
    description: 'Preserve only one space when multiple are present',
    input: '<html><body>Need <span> more </span> space<i>  s </i> !<br></body></html>',
    wantHTML: '<!DOCTYPE HTML><html><body>Need more space<em> s </em>!<br><br></body></html>',
    wantText: 'Need more space s !\n\n',
  },
  'collapseSpacesAcrossNewlines': {
    description: 'Newlines and multiple spaces across newlines should be collapsed',
    input: `
      <html><body>Need
          <span> more </span>
          space
          <i>  s </i>
          !<br></body></html>`,
    wantHTML: '<!DOCTYPE HTML><html><body>Need more space <em>s </em>!<br><br></body></html>',
    wantText: 'Need more space s !\n\n',
  },
  'multipleNewLinesAtBeginning': {
    description: 'Multiple new lines and paragraphs at the beginning should be preserved',
    input: '<html><body><br><br><p></p><p></p>first line<br><br>second line<br></body></html>',
    wantHTML: '<!DOCTYPE HTML><html><body><br><br><br><br>first line<br><br>second line<br><br></body></html>',
    wantText: '\n\n\n\nfirst line\n\nsecond line\n\n',
  },
  'multiLineParagraph': {
    description: 'A paragraph with multiple lines should not loose spaces when lines are combined',
    input: `<html><body>
    <p>
      а б в г ґ д е є ж з и і ї й к л м н о
      п р с т у ф х ц ч ш щ ю я ь
    </p>
</body></html>`,
    wantHTML: '<!DOCTYPE HTML><html><body>&#1072; &#1073; &#1074; &#1075; &#1169; &#1076; &#1077; &#1108; &#1078; &#1079; &#1080; &#1110; &#1111; &#1081; &#1082; &#1083; &#1084; &#1085; &#1086; &#1087; &#1088; &#1089; &#1090; &#1091; &#1092; &#1093; &#1094; &#1095; &#1096; &#1097; &#1102; &#1103; &#1100;<br><br></body></html>',
    wantText: 'а б в г ґ д е є ж з и і ї й к л м н о п р с т у ф х ц ч ш щ ю я ь\n\n',
  },
  'multiLineParagraphWithPre': {
    // XXX why is there &nbsp; before "in"?
    description: 'lines in preformatted text should be kept intact',
    input: `<html><body>
    <p>
        а б в г ґ д е є ж з и і ї й к л м н о<pre>multiple
   lines
 in
      pre
</pre></p><p>п р с т у ф х ц ч ш щ ю я
ь</p>
</body></html>`,
    wantHTML: '<!DOCTYPE HTML><html><body>&#1072; &#1073; &#1074; &#1075; &#1169; &#1076; &#1077; &#1108; &#1078; &#1079; &#1080; &#1110; &#1111; &#1081; &#1082; &#1083; &#1084; &#1085; &#1086;<br>multiple<br>&nbsp;&nbsp; lines<br>&nbsp;in<br>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; pre<br><br>&#1087; &#1088; &#1089; &#1090; &#1091; &#1092; &#1093; &#1094; &#1095; &#1096; &#1097; &#1102; &#1103; &#1100;<br><br></body></html>',
    wantText: 'а б в г ґ д е є ж з и і ї й к л м н о\nmultiple\n   lines\n in\n      pre\n\nп р с т у ф х ц ч ш щ ю я ь\n\n',
  },
  'preIntroducesASpace': {
    description: 'pre should be on a new line not preceded by a space',
    input: `<html><body><p>
    1
<pre>preline
</pre></p></body></html>`,
    wantHTML: '<!DOCTYPE HTML><html><body>1<br>preline<br><br><br></body></html>',
    wantText: '1\npreline\n\n\n',
  },
  'dontDeleteSpaceInsideElements': {
    description: 'Preserve spaces inside elements',
    input: '<html><body>Need<span> more </span>space<i> s </i>!<br></body></html>',
    wantHTML: '<!DOCTYPE HTML><html><body>Need more space<em> s </em>!<br><br></body></html>',
    wantText: 'Need more space s !\n\n',
  },
  'dontDeleteSpaceOutsideElements': {
    description: 'Preserve spaces outside elements',
    input: '<html><body>Need <span>more</span> space <i>s</i> !<br></body></html>',
    wantHTML: '<!DOCTYPE HTML><html><body>Need more space <em>s</em> !<br><br></body></html>',
    wantText: 'Need more space s !\n\n',
  },
  'dontDeleteSpaceAtEndOfElement': {
    description: 'Preserve spaces at the end of an element',
    input: '<html><body>Need <span>more </span>space <i>s </i>!<br></body></html>',
    wantHTML: '<!DOCTYPE HTML><html><body>Need more space <em>s </em>!<br><br></body></html>',
    wantText: 'Need more space s !\n\n',
  },
  'dontDeleteSpaceAtBeginOfElements': {
    description: 'Preserve spaces at the start of an element',
    input: '<html><body>Need<span> more</span> space<i> s</i> !<br></body></html>',
    wantHTML: '<!DOCTYPE HTML><html><body>Need more space<em> s</em> !<br><br></body></html>',
    wantText: 'Need more space s !\n\n',
  },
};

describe(__filename, function () {
  this.timeout(1000);

  before(async function () { agent = await common.init(); });

  Object.keys(testImports).forEach((testName) => {
    describe(testName, function () {
      const testPadId = makeid();
      const test = testImports[testName];
      if (test.disabled) {
        return xit(`DISABLED: ${testName}`, function (done) {
          done();
        });
      }

      it('createPad', async function () {
        const res = await agent.get(`${endPoint('createPad')}?padID=${testPadId}`)
            .set("authorization", await common.generateJWTToken())
            .expect(200)
            .expect('Content-Type', /json/);
        assert.equal(res.body.code, 0);
      });

      it('setHTML', async function () {
        const res = await agent.get(`${endPoint('setHTML')}?padID=${testPadId}` +
                        `&html=${encodeURIComponent(test.input)}`)
            .set("authorization", await common.generateJWTToken())
            .expect(200)
            .expect('Content-Type', /json/);
        assert.equal(res.body.code, 0);
      });

      it('getHTML', async function () {
        const res = await agent.get(`${endPoint('getHTML')}?padID=${testPadId}`)
            .set("authorization", await common.generateJWTToken())
            .expect(200)
            .expect('Content-Type', /json/);
        assert.equal(res.body.data.html, test.wantHTML);
      });

      it('getText', async function () {
        const res = await agent.get(`${endPoint('getText')}?padID=${testPadId}`)
            .set("authorization", await common.generateJWTToken())
            .expect(200)
            .expect('Content-Type', /json/);
        assert.equal(res.body.data.text, test.wantText);
      });
    });
  });
});

function makeid() {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

  for (let i = 0; i < 5; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
