'use strict';

describe('author of pad edition', function () {
  const REGULAR_LINE = 0;
  const LINE_WITH_ORDERED_LIST = 1;
  const LINE_WITH_UNORDERED_LIST = 2;

  // author 1 creates a new pad with some content (regular lines and lists)
  before(async function () {
    const padId = await helper.aNewPad();

    // make sure pad has at least 3 lines
    const $firstLine = helper.padInner$('div').first();
    const threeLines = ['regular line', 'line with ordered list', 'line with unordered list']
        .join('<br>');
    $firstLine.html(threeLines);

    // wait for lines to be processed by Etherpad
    await helper.waitForPromise(() => (
      getLine(LINE_WITH_UNORDERED_LIST).text() === 'line with unordered list' &&
      helper.commits.length === 1));

    // create the unordered list
    const $lineWithUnorderedList = getLine(LINE_WITH_UNORDERED_LIST);
    $lineWithUnorderedList.sendkeys('{selectall}');

    const $insertUnorderedListButton = helper.padChrome$('.buttonicon-insertunorderedlist');
    $insertUnorderedListButton.trigger('click');

    await helper.waitForPromise(() => (
      getLine(LINE_WITH_UNORDERED_LIST).find('ul li').length === 1 &&
      helper.commits.length === 2));

    // create the ordered list
    const $lineWithOrderedList = getLine(LINE_WITH_ORDERED_LIST);
    $lineWithOrderedList.sendkeys('{selectall}');

    const $insertOrderedListButton = helper.padChrome$('.buttonicon-insertorderedlist');
    $insertOrderedListButton.trigger('click');

    await helper.waitForPromise(() => (
      getLine(LINE_WITH_ORDERED_LIST).find('ol li').length === 1 &&
      helper.commits.length === 3));

    // Expire cookie, so author is changed after reloading the pad.
    const {Cookies} = helper.padChrome$.window.require('ep_etherpad-lite/static/js/pad_utils');
    Cookies.remove('token');

    // Reload pad, to make changes as a second user.
    await helper.aNewPad({id: padId});
  });

  // author 2 makes some changes on the pad
  it('regular line', async function () {
    await changeLineAndCheckOnlyThatChangeIsFromThisAuthor(REGULAR_LINE, 'x');
  });

  it('line with ordered list', async function () {
    await changeLineAndCheckOnlyThatChangeIsFromThisAuthor(LINE_WITH_ORDERED_LIST, 'y');
  });

  it('line with unordered list', async function () {
    await changeLineAndCheckOnlyThatChangeIsFromThisAuthor(LINE_WITH_UNORDERED_LIST, 'z');
  });

  /* ********************** Helper functions ************************ */
  const getLine = (lineNumber) => helper.padInner$('div').eq(lineNumber);

  const getAuthorFromClassList = (classes) => classes.find((cls) => cls.startsWith('author'));

  const changeLineAndCheckOnlyThatChangeIsFromThisAuthor = async (lineNumber, textChange) => {
    // get original author class
    const classes = getLine(lineNumber).find('span').first().attr('class').split(' ');
    const originalAuthor = getAuthorFromClassList(classes);

    // make change on target line
    const $regularLine = getLine(lineNumber);
    helper.selectLines($regularLine, $regularLine, 2, 2); // place caret after 2nd char of line
    $regularLine.sendkeys(textChange);

    // wait for change to be processed by Etherpad
    let otherAuthorsOfLine;
    await helper.waitForPromise(() => {
      const authorsOfLine = getLine(lineNumber).find('span').map(function () {
        return getAuthorFromClassList($(this).attr('class').split(' '));
      }).get();
      otherAuthorsOfLine = authorsOfLine.filter((author) => author !== originalAuthor);
      const lineHasChangeOfThisAuthor = otherAuthorsOfLine.length > 0;
      return lineHasChangeOfThisAuthor;
    });
    const thisAuthor = otherAuthorsOfLine[0];
    const $changeOfThisAuthor = getLine(lineNumber).find(`span.${thisAuthor}`);
    expect($changeOfThisAuthor.text()).to.be(textChange);
  };
});
