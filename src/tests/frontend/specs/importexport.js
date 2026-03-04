'use strict';

describe('importexport.js', function () {
  const testCases = [
    {
      name: 'text with newlines',
      inputText: [
        'imported text\n',
        'newline',
      ].join(''),
      wantPadLines: [
        '<span class="">imported text</span>',
        '<span class="">newline</span>',
      ],
      wantExportHtmlBody: [
        'imported text<br>',
        'newline<br>',
      ].join(''),
      wantExportText: [
        'imported text\n',
        'newline\n',
      ].join(''),
    },
    {
      name: 'HTML with newlines',
      inputHtmlBody: [
        'htmltext<br>',
        'newline',
      ].join(''),
      wantPadLines: [
        '<span class="">htmltext</span>',
        '<span class="">newline</span>',
        '<br>',
      ],
      wantExportHtmlBody: [
        'htmltext<br>',
        'newline<br>',
        '<br>',
      ].join(''),
      wantExportText: [
        'htmltext\n',
        'newline\n',
        '\n',
      ].join(''),
    },
    {
      name: 'HTML with attributes',
      inputHtmlBody: [
        'htmltext<br>',
        '<span class="b s i u"><b><i><s><u>newline</u></s></i></b>',
      ].join(''),
      wantPadLines: [
        '<span class="">htmltext</span>',
        '<span class="b i s u"><b><i><s><u>newline</u></s></i></b></span>',
        '<br>',
      ],
      wantExportHtmlBody: [
        'htmltext<br>',
        '<strong><em><s><u>newline</u></s></em></strong><br>',
        '<br>',
      ].join(''),
      wantExportText: [
        'htmltext\n',
        'newline\n',
        '\n',
      ].join(''),
    },
    {
      name: 'HTML with bullets',
      inputHtmlBody: [
        '<ul class="list-bullet1">',
        ' <li>bullet line 1</li>',
        ' <li>bullet line 2',
        '  <ul class="list-bullet2">',
        '   <li>bullet2 line 1</li>',
        '   <li>bullet2 line 2</li>',
        '  </ul>',
        ' </li>',
        '</ul>',
      ].join(''),
      wantPadLines: [
        '<ul class="list-bullet1"><li><span class="">bullet line 1</span></li></ul>',
        '<ul class="list-bullet1"><li><span class="">bullet line 2</span></li></ul>',
        '<ul class="list-bullet2"><li><span class="">bullet2 line 1</span></li></ul>',
        '<ul class="list-bullet2"><li><span class="">bullet2 line 2</span></li></ul>',
        '<br>',
      ],
      wantExportHtmlBody: [
        '<ul class=bullet>',
        ' <li>bullet line 1</li>',
        ' <li>bullet line 2',
        '  <ul class=bullet>',
        '   <li>bullet2 line 1</li>',
        '   <li>bullet2 line 2</li>',
        '  </ul>',
        ' </li>',
        '</ul>',
        '<br>',
      ].map((l) => l.replace(/^\s+/, '')).join(''),
      wantExportText: [
        '\t* bullet line 1\n',
        '\t* bullet line 2\n',
        '\t\t* bullet2 line 1\n',
        '\t\t* bullet2 line 2\n',
        '\n',
      ].join(''),
    },
    {
      name: 'HTML with bullets and newlines',
      inputHtmlBody: [
        '<ul class="list-bullet1">',
        ' <li>bullet line 1</li>',
        '</ul>',
        '<br>',
        '<ul class="list-bullet1">',
        ' <li>bullet line 2',
        '  <ul class="list-bullet2">',
        '   <li>bullet2 line 1</li>',
        '  </ul>',
        ' </li>',
        '</ul>',
        '<br>',
        '<ul class="list-bullet1">',
        ' <li>',
        '  <ul class="list-bullet2">',
        '   <li>bullet2 line 2</li>',
        '  </ul>',
        ' </li>',
        '</ul>',
      ].join(''),
      wantPadLines: [
        '<ul class="list-bullet1"><li><span class="">bullet line 1</span></li></ul>',
        '<br>',
        '<ul class="list-bullet1"><li><span class="">bullet line 2</span></li></ul>',
        '<ul class="list-bullet2"><li><span class="">bullet2 line 1</span></li></ul>',
        '<br>',
        '<ul class="list-bullet2"><li><span class="">bullet2 line 2</span></li></ul>',
        '<br>',
      ],
      wantExportHtmlBody: [
        '<ul class=bullet>',
        ' <li>bullet line 1</li>',
        '</ul>',
        '<br>',
        '<ul class=bullet>',
        ' <li>bullet line 2',
        '  <ul class=bullet>',
        '   <li>bullet2 line 1</li>',
        '  </ul>',
        ' </li>',
        '</ul>',
        '<br>',
        '<ul class=bullet>',
        ' <li>',
        '  <ul class=bullet>',
        '   <li>bullet2 line 2</li>',
        '  </ul>',
        ' </li>',
        '</ul>',
        '<br>',
      ].map((l) => l.replace(/^\s+/, '')).join(''),
      wantExportText: [
        '\t* bullet line 1\n',
        '\n',
        '\t* bullet line 2\n',
        '\t\t* bullet2 line 1\n',
        '\n',
        '\t\t* bullet2 line 2\n',
        '\n',
      ].join(''),
    },
    {
      name: 'HTML with bullets, newlines, and attributes',
      inputHtmlBody: [
        '<ul class="list-bullet1">',
        ' <li>bullet line 1</li>',
        '</ul>',
        '<br>',
        '<ul class="list-bullet1">',
        ' <li>bullet line 2',
        '  <ul class="list-bullet2">',
        '   <li>bullet2 line 1</li>',
        '  </ul>',
        ' </li>',
        '</ul>',
        '<br>',
        '<ul class="list-bullet1">',
        ' <li>',
        '  <ul class="list-bullet2">',
        '   <li>',
        '    <ul class="list-bullet3">',
        '     <li>',
        '      <ul class="list-bullet4">',
        '       <li><span class="b s i u"><b><i><s><u>bullet4 line 2 bisu</u>' +
                   '</s></i></b></span></li>',
        '       <li><span class="b s "><b><s>bullet4 line 2 bs</s></b></span></li>',
        '       <li><span class="u"><u>bullet4 line 2 u</u></span>' +
                   '<span class="u i s"><i><s><u>uis</u></s></i></span></li>',
        '      </ul>',
        '     </li>',
        '    </ul>',
        '   </li>',
        '  </ul>',
        ' </li>',
        '</ul>',
      ].join(''),
      wantPadLines: [
        '<ul class="list-bullet1"><li><span class="">bullet line 1</span></li></ul>',
        '<br>',
        '<ul class="list-bullet1"><li><span class="">bullet line 2</span></li></ul>',
        '<ul class="list-bullet2"><li><span class="">bullet2 line 1</span></li></ul>',
        '<br>',
        '<ul class="list-bullet4"><li><span class="b i s u"><b><i><s><u>' +
            'bullet4 line 2 bisu</u></s></i></b></span></li></ul>',
        '<ul class="list-bullet4"><li><span class="b s"><b><s>bullet4 line 2 bs</s>' +
            '</b></span></li></ul>',
        '<ul class="list-bullet4"><li><span class="u"><u>bullet4 line 2 u</u></span>' +
            '<span class="i s u"><i><s><u>uis</u></s></i></span></li></ul>',
        '<br>',
      ],
      wantExportHtmlBody: [
        '<ul class=bullet><li>bullet line 1</li></ul>',
        '<br>',
        '<ul class=bullet>',
        ' <li>bullet line 2',
        '  <ul class=bullet><li>bullet2 line 1</li></ul>',
        ' </li>',
        '</ul>',
        '<br>',
        '<ul class=bullet>',
        ' <li>',
        '  <ul class=bullet>',
        '   <li>',
        '    <ul class=bullet>',
        '     <li>',
        '      <ul class=bullet>',
        '       <li><strong><em><s><u>bullet4 line 2 bisu</u></s></em></strong></li>',
        '       <li><strong><s>bullet4 line 2 bs</s></strong></li>',
        '       <li><u>bullet4 line 2 u<em><s>uis</s></em></u></li>',
        '      </ul>',
        '     </li>',
        '    </ul>',
        '   </li>',
        '  </ul>',
        ' </li>',
        '</ul>',
        '<br>',
      ].map((l) => l.replace(/^\s+/, '')).join(''),
      wantExportText: [
        '\t* bullet line 1\n',
        '\n',
        '\t* bullet line 2\n',
        '\t\t* bullet2 line 1\n',
        '\n',
        '\t\t\t\t* bullet4 line 2 bisu\n',
        '\t\t\t\t* bullet4 line 2 bs\n',
        '\t\t\t\t* bullet4 line 2 uuis\n',
        '\n',
      ].join(''),
    },
    {
      name: 'HTML with nested bullets',
      inputHtmlBody: [
        '<ul class="list-bullet1"><li>bullet line 1</li></ul>',
        '<ul class="list-bullet1">',
        ' <li>bullet line 2',
        '  <ul class="list-bullet2">',
        '   <li>bullet2 line 1</li>',
        '  </ul>',
        ' </li>',
        '</ul>',
        '<ul class="list-bullet1">',
        ' <li>',
        '  <ul class="list-bullet2">',
        '   <li>',
        '    <ul class="list-bullet3">',
        '     <li>',
        '      <ul class="list-bullet4">',
        '       <li>bullet4 line 2</li>',
        '       <li>bullet4 line 2</li>',
        '       <li>bullet4 line 2</li>',
        '      </ul>',
        '     </li>',
        '     <li>bullet3 line 1</li>',
        '    </ul>',
        '   </li>',
        '  </ul>',
        ' </li>',
        '</ul>',
      ].join(''),
      wantPadLines: [
        '<ul class="list-bullet1"><li><span class="">bullet line 1</span></li></ul>',
        '<ul class="list-bullet1"><li><span class="">bullet line 2</span></li></ul>',
        '<ul class="list-bullet2"><li><span class="">bullet2 line 1</span></li></ul>',
        '<ul class="list-bullet4"><li><span class="">bullet4 line 2</span></li></ul>',
        '<ul class="list-bullet4"><li><span class="">bullet4 line 2</span></li></ul>',
        '<ul class="list-bullet4"><li><span class="">bullet4 line 2</span></li></ul>',
        '<ul class="list-bullet3"><li><span class="">bullet3 line 1</span></li></ul>',
        '<br>',
      ],
      wantExportHtmlBody: [
        '<ul class=bullet>',
        ' <li>bullet line 1</li>',
        ' <li>bullet line 2',
        '  <ul class=bullet>',
        '   <li>bullet2 line 1',
        '    <ul class=bullet>',
        '     <li>',
        '      <ul class=bullet>',
        '       <li>bullet4 line 2</li>',
        '       <li>bullet4 line 2</li>',
        '       <li>bullet4 line 2</li>',
        '      </ul>',
        '     </li>',
        '     <li>bullet3 line 1</li>',
        '    </ul>',
        '   </li>',
        '  </ul>',
        ' </li>',
        '</ul>',
        '<br>',
      ].map((l) => l.replace(/^\s+/, '')).join(''),
      wantExportText: [
        '\t* bullet line 1\n',
        '\t* bullet line 2\n',
        '\t\t* bullet2 line 1\n',
        '\t\t\t\t* bullet4 line 2\n',
        '\t\t\t\t* bullet4 line 2\n',
        '\t\t\t\t* bullet4 line 2\n',
        '\t\t\t* bullet3 line 1\n',
        '\n',
      ].join(''),
    },
    {
      name: 'HTML with 8 levels of bullets, newlines, and attributes',
      inputHtmlBody: [
        '<ul class="list-bullet1">',
        ' <li>bullet line 1</li>',
        '</ul>',
        '<br>',
        '<ul class="list-bullet1">',
        ' <li>bullet line 2',
        '  <ul class="list-bullet2">',
        '   <li>bullet2 line 1</li>',
        '  </ul>',
        ' </li>',
        '</ul>',
        '<br>',
        '<ul class="list-bullet1">',
        ' <li>',
        '  <ul class="list-bullet2">',
        '   <li>',
        '    <ul class="list-bullet3">',
        '     <li>',
        '      <ul class="list-bullet4">',
        '       <li><span class="b s i u"><b><i><s><u>bullet4 line 2 bisu' +
                   '</u></s></i></b></span></li>',
        '       <li><span class="b s "><b><s>bullet4 line 2 bs</s></b></span></li>',
        '       <li><span class="u"><u>bullet4 line 2 u</u></span>' +
                   '<span class="u i s"><i><s><u>uis</u></s></i></span></li>',
        '       <li>',
        '        <ul class="list-bullet5">',
        '         <li>',
        '          <ul class="list-bullet6">',
        '           <li>',
        '            <ul class="list-bullet7">',
        '             <li>',
        '              <ul class="list-bullet8">',
        '               <li><span class="">foo</span></li>',
        '               <li><span class="b s"><b><s>foobar bs</b></s></span></li>',
        '              </ul>',
        '             </li>',
        '            </ul>',
        '           </li>',
        '          </ul>',
        '         </li>',
        '        </ul>',
        '       </li>',
        '       <li>',
        '        <ul class="list-bullet5">',
        '         <li>foobar</li>',
        '        </ul>',
        '       </li>',
        '      </ul>',
        '     </li>',
        '    </ul>',
        '   </li>',
        '  </ul>',
        ' </li>',
        '</ul>',
      ].join(''),
      wantPadLines: [
        '<ul class="list-bullet1"><li><span class="">bullet line 1</span></li></ul>',
        '<br>',
        '<ul class="list-bullet1"><li><span class="">bullet line 2</span></li></ul>',
        '<ul class="list-bullet2"><li><span class="">bullet2 line 1</span></li></ul>',
        '<br>',
        '<ul class="list-bullet4"><li><span class="b i s u"><b><i><s><u>' +
            'bullet4 line 2 bisu</u></s></i></b></span></li></ul>',
        '<ul class="list-bullet4"><li><span class="b s"><b><s>bullet4 line 2 bs</s>' +
            '</b></span></li></ul>',
        '<ul class="list-bullet4"><li><span class="u"><u>bullet4 line 2 u</u></span>' +
            '<span class="i s u"><i><s><u>uis</u></s></i></span></li></ul>',
        '<ul class="list-bullet8"><li><span class="">foo</span></li></ul>',
        '<ul class="list-bullet8"><li><span class="b s"><b><s>foobar bs</s></b></span></li></ul>',
        '<ul class="list-bullet5"><li><span class="">foobar</span></li></ul>',
        '<br>',
      ],
      wantExportHtmlBody: [
        '<ul class=bullet>',
        ' <li>bullet line 1</li>',
        '</ul>',
        '<br>',
        '<ul class=bullet>',
        ' <li>bullet line 2',
        '  <ul class=bullet>',
        '   <li>bullet2 line 1</li>',
        '  </ul>',
        ' </li>',
        '</ul>',
        '<br>',
        '<ul class=bullet>',
        ' <li>',
        '  <ul class=bullet>',
        '   <li>',
        '    <ul class=bullet>',
        '     <li>',
        '      <ul class=bullet>',
        '       <li><strong><em><s><u>bullet4 line 2 bisu</u></s></em></strong></li>',
        '       <li><strong><s>bullet4 line 2 bs</s></strong></li>',
        '       <li><u>bullet4 line 2 u<em><s>uis</s></em></u>',
        '        <ul class=bullet>',
        '         <li>',
        '          <ul class=bullet>',
        '           <li>',
        '            <ul class=bullet>',
        '             <li>',
        '              <ul class=bullet>',
        '               <li>foo</li>',
        '               <li><strong><s>foobar bs</s></strong></li>',
        '              </ul>',
        '             </li>',
        '            </ul>',
        '           </li>',
        '          </ul>',
        '         </li>',
        '         <li>foobar</li>',
        '        </ul>',
        '       </li>',
        '      </ul>',
        '     </li>',
        '    </ul>',
        '   </li>',
        '  </ul>',
        ' </li>',
        '</ul>',
        '<br>',
      ].map((l) => l.replace(/^\s+/, '')).join(''),
      wantExportText: [
        '\t* bullet line 1\n',
        '\n',
        '\t* bullet line 2\n',
        '\t\t* bullet2 line 1\n',
        '\n',
        '\t\t\t\t* bullet4 line 2 bisu\n',
        '\t\t\t\t* bullet4 line 2 bs\n',
        '\t\t\t\t* bullet4 line 2 uuis\n',
        '\t\t\t\t\t\t\t\t* foo\n',
        '\t\t\t\t\t\t\t\t* foobar bs\n',
        '\t\t\t\t\t* foobar\n',
        '\n',
      ].join(''),
    },
    {
      name: 'HTML with ordered lists',
      inputHtmlBody: [
        '<ol class="list-number1" start="1"><li>number 1 line 1</li></ol>',
        '<ol class="list-number1" start="2"><li>number 2 line 2</li></ol>',
      ].join(''),
      wantPadLines: [
        '<ol start="1" class="list-number1"><li><span class="">number 1 line 1</span></li></ol>',
        '<ol start="2" class="list-number1"><li><span class="">number 2 line 2</span></li></ol>',
        '<br>',
      ],
      wantExportHtmlBody: [
        '<ol start=1 class=number>',
        ' <li>number 1 line 1</li>',
        ' <li>number 2 line 2</li>',
        '</ol>',
        '<br>',
      ].map((l) => l.replace(/^\s+/, '')).join(''),
      wantExportText: [
        '\t1. number 1 line 1\n',
        '\t2. number 2 line 2\n',
        '\n',
      ].join(''),
    },
  ];

  let confirm;
  before(async function () {
    await helper.aNewPad();
    confirm = helper.padChrome$.window.confirm;
    helper.padChrome$.window.confirm = () => true;
    // As of 2021-02-22 a mutable FileList cannot be directly created so DataTransfer is used as a
    // hack to access a mutable FileList for testing the '<input type="file">' element. DataTransfer
    // itself is quite new so support for it is tested here. See:
    //   * https://github.com/whatwg/html/issues/3269
    //   * https://stackoverflow.com/q/47119426
    try {
      const dt = new DataTransfer();
      dt.items.add(new File(['testing'], 'file.txt', {type: 'text/plain'}));
      // Supposedly all modern browsers support a settable HTMLInputElement.files property, but
      // Firefox 52 complains.
      helper.padChrome$('#importform input[type=file]')[0].files = dt.files;
    } catch (err) {
      return this.skip();
    }
  });

  after(async function () {
    helper.padChrome$.window.confirm = confirm;
  });

  beforeEach(async function () {
    const popup = helper.padChrome$('#import_export');
    const isVisible = () => popup.hasClass('popup-show');
    if (isVisible()) return;
    const button = helper.padChrome$('button[data-l10n-id="pad.toolbar.import_export.title"]');
    button.trigger('click');
    await helper.waitForPromise(isVisible);
  });

  const docToHtml = (() => {
    const s = new XMLSerializer();
    return (doc) => s.serializeToString(doc);
  })();

  const htmlToDoc = (() => {
    const p = new DOMParser();
    return (html) => p.parseFromString(html, 'text/html');
  })();

  const htmlBodyToDoc = (htmlBody) => {
    const doc = document.implementation.createHTMLDocument();
    $('body', doc).html(htmlBody);
    return doc;
  };

  for (const tc of testCases) {
    describe(tc.name, function () {
      it('import', async function () {
        const ext = tc.inputHtmlBody ? 'html' : 'txt';
        const contents = ext === 'html' ? docToHtml(htmlBodyToDoc(tc.inputHtmlBody)) : tc.inputText;
        // DataTransfer is used as a hacky way to get a mutable FileList. For details, see:
        // https://stackoverflow.com/q/47119426
        const dt = new DataTransfer();
        dt.items.add(new File([contents], `file.${ext}`, {type: 'text/plain'}));
        const form = helper.padChrome$('#importform');
        form.find('input[type=file]')[0].files = dt.files;
        form.find('#importsubmitinput').trigger('submit');
        try {
          await helper.waitForPromise(() => {
            const got = helper.linesDiv();
            if (got.length !== tc.wantPadLines.length) return false;
            for (let i = 0; i < got.length; i++) {
              const gotDiv = $('<div>').html(got[i].html());
              const wantDiv = $('<div>').html(tc.wantPadLines[i]);
              if (!gotDiv[0].isEqualNode(wantDiv[0])) return false;
            }
            return true;
          });
        } catch (err) {
          const formatLine = (l) => `  ${JSON.stringify(l)}`;
          const g = helper.linesDiv().map((div) => formatLine(div.html())).join('\n');
          const w = tc.wantPadLines.map(formatLine).join('\n');
          throw new Error(`Import failed. Got pad lines:\n${g}\nWant pad lines:\n${w}`);
        }
      });

      it('export to HTML', async function () {
        const link = helper.padChrome$('#exporthtmla').attr('href');
        const url = new URL(link, helper.padChrome$.window.location.href).href;
        const gotHtml = await $.ajax({url, dataType: 'html'});
        const gotBody = $('body', htmlToDoc(gotHtml));
        gotBody.html(gotBody.html().replace(/^\s+|\s+$/g, ''));
        const wantBody = $('body', htmlBodyToDoc(tc.wantExportHtmlBody));
        if (!gotBody[0].isEqualNode(wantBody[0])) {
          throw new Error(`Got exported HTML body:\n  ${JSON.stringify(gotBody.html())}\n` +
                          `Want HTML body:\n  ${JSON.stringify(wantBody.html())}`);
        }
      });

      it('export to text', async function () {
        const link = helper.padChrome$('#exportplaina').attr('href');
        const url = new URL(link, helper.padChrome$.window.location.href).href;
        const got = await $.ajax({url, dataType: 'text'});
        expect(got).to.be(tc.wantExportText);
      });
    });
  }
});
