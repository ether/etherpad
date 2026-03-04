'use strict';

describe('author of pad edition', function () {
  // author 1 creates a new pad with some content (regular lines and lists)
  before(async function () {
    const padId = await helper.aNewPad();

    // make sure pad has at least 3 lines
    const $firstLine = helper.padInner$('div').first();
    $firstLine.html('Hello World');

    // wait for lines to be processed by Etherpad
    await helper.waitForPromise(() => (
      $firstLine.text() === 'Hello World' && helper.commits.length === 1));

    // Delete token cookie, so author is changed after reloading the pad.
    const {Cookies} = helper.padChrome$.window.require('ep_etherpad-lite/static/js/pad_utils');
    Cookies.remove('token');

    // Reload pad, to make changes as a second user.
    await helper.aNewPad({id: padId});
  });

  // author 2 makes some changes on the pad
  it('Clears Authorship by second user', async function () {
    const inner$ = helper.padInner$;
    const chrome$ = helper.padChrome$;

    // override the confirm dialogue functioon
    helper.padChrome$.window.confirm = function () {
      return true;
    };

    // get the clear authorship colors button and click it
    const $clearauthorshipcolorsButton = chrome$('.buttonicon-clearauthorship');
    $clearauthorshipcolorsButton.trigger('click');

    // does the first divs span include an author class?
    const hasAuthorClass = inner$('div span').first().attr('class').indexOf('author') !== -1;

    expect(hasAuthorClass).to.be(false);
  });
});
