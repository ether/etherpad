'use strict';

describe('select formatting buttons when selection has style applied', function () {
  const STYLES = ['italic', 'bold', 'underline', 'strikethrough'];
  const SHORTCUT_KEYS = ['I', 'B', 'U', '5']; // italic, bold, underline, strikethrough
  const FIRST_LINE = 0;

  before(async function () {
    await helper.aNewPad();
  });

  const applyStyleOnLine = function (style, line) {
    const chrome$ = helper.padChrome$;
    selectLine(line);
    const $formattingButton = chrome$(`.buttonicon-${style}`);
    $formattingButton.trigger('click');
  };

  const isButtonSelected = function (style) {
    const chrome$ = helper.padChrome$;
    const $formattingButton = chrome$(`.buttonicon-${style}`);
    return $formattingButton.parent().hasClass('selected');
  };

  const selectLine = function (lineNumber, offsetStart, offsetEnd) {
    const inner$ = helper.padInner$;
    const $line = inner$('div').eq(lineNumber);
    helper.selectLines($line, $line, offsetStart, offsetEnd);
  };

  const placeCaretOnLine = function (lineNumber) {
    const inner$ = helper.padInner$;
    const $line = inner$('div').eq(lineNumber);
    $line.sendkeys('{leftarrow}');
  };

  const undo = async function () {
    const originalHTML = helper.padInner$('body').html();
    const $undoButton = helper.padChrome$('.buttonicon-undo');
    $undoButton.trigger('click');
    await helper.waitForPromise(() => helper.padInner$('body').html() !== originalHTML);
  };

  const testIfFormattingButtonIsDeselected = function (style) {
    it(`deselects the ${style} button`, async function () {
      await helper.waitForPromise(() => !isButtonSelected(style));
    });
  };

  const testIfFormattingButtonIsSelected = function (style) {
    it(`selects the ${style} button`, async function () {
      await helper.waitForPromise(() => isButtonSelected(style));
    });
  };

  const applyStyleOnLineAndSelectIt = async function (line, style) {
    await applyStyleOnLineOnFullLineAndRemoveSelection(line, style, selectLine);
  };

  const applyStyleOnLineAndPlaceCaretOnit = async function (line, style) {
    await applyStyleOnLineOnFullLineAndRemoveSelection(line, style, placeCaretOnLine);
  };

  const applyStyleOnLineOnFullLineAndRemoveSelection = async function (line, style, selectTarget) {
    // see if line html has changed
    const inner$ = helper.padInner$;
    const oldLineHTML = inner$.find('div')[line];
    applyStyleOnLine(style, line);

    await helper.waitForPromise(() => {
      const lineHTML = inner$.find('div')[line];
      return lineHTML !== oldLineHTML;
    });
    // remove selection from previous line
    selectLine(line + 1);
    // select the text or place the caret on a position that
    // has the formatting text applied previously
    selectTarget(line);
  };

  const pressFormattingShortcutOnSelection = async function (key) {
    const inner$ = helper.padInner$;
    const originalHTML = helper.padInner$('body').html();

    // get the first text element out of the inner iframe
    const $firstTextElement = inner$('div').first();

    // select this text element
    $firstTextElement.sendkeys('{selectall}');

    const e = new inner$.Event(helper.evtType);
    e.ctrlKey = true; // Control key
    e.which = key.charCodeAt(0); // I, U, B, 5
    inner$('#innerdocbody').trigger(e);
    await helper.waitForPromise(() => helper.padInner$('body').html() !== originalHTML);
  };

  STYLES.forEach((style) => {
    context(`when selection is in a text with ${style} applied`, function () {
      before(async function () {
        this.timeout(4000);
        await applyStyleOnLineAndSelectIt(FIRST_LINE, style);
      });

      after(async function () {
        await undo();
      });

      testIfFormattingButtonIsSelected(style);
    });

    context(`when caret is in a position with ${style} applied`, function () {
      before(async function () {
        this.timeout(4000);
        await applyStyleOnLineAndPlaceCaretOnit(FIRST_LINE, style);
      });

      after(async function () {
        await undo();
      });

      testIfFormattingButtonIsSelected(style);
    });
  });

  context('when user applies a style and the selection does not change', function () {
    it('selects the style button', async function () {
      const style = STYLES[0]; // italic
      applyStyleOnLine(style, FIRST_LINE);
      await helper.waitForPromise(() => isButtonSelected(style) === true);
      applyStyleOnLine(style, FIRST_LINE);
    });
  });

  SHORTCUT_KEYS.forEach((key, index) => {
    const styleOfTheShortcut = STYLES[index]; // italic, bold, ...
    context(`when user presses CMD + ${key}`, function () {
      before(async function () {
        await pressFormattingShortcutOnSelection(key);
      });

      testIfFormattingButtonIsSelected(styleOfTheShortcut);

      context(`and user presses CMD + ${key} again`, function () {
        before(async function () {
          await pressFormattingShortcutOnSelection(key);
        });

        testIfFormattingButtonIsDeselected(styleOfTheShortcut);
      });
    });
  });
});
