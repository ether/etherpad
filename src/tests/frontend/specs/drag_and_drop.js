'use strict';

// WARNING: drag and drop is only simulated on these tests, manual testing might also be necessary
describe('drag and drop', function () {
  before(async function () {
    await helper.aNewPad();
    await createScriptWithSeveralLines();
  });

  context('when user drags part of one line and drops it far form its original place', function () {
    before(async function () {
      selectPartOfSourceLine();
      dragSelectedTextAndDropItIntoMiddleOfLine(TARGET_LINE);

      // make sure DnD was correctly simulated
      await helper.waitForPromise(() => {
        const $targetLine = getLine(TARGET_LINE);
        const sourceWasMovedToTarget = $targetLine.text() === 'Target line [line 1]';
        return sourceWasMovedToTarget;
      });
    });

    context('and user triggers UNDO', function () {
      before(async function () {
        const originalHTML = helper.padInner$('body').html();
        const $undoButton = helper.padChrome$('.buttonicon-undo');
        $undoButton.trigger('click');
        await helper.waitForPromise(() => helper.padInner$('body').html() !== originalHTML);
      });

      it('moves text back to its original place', async function () {
        // test text was removed from drop target
        const $targetLine = getLine(TARGET_LINE);
        expect($targetLine.text()).to.be('Target line []');

        // test text was added back to original place
        const $firstSourceLine = getLine(FIRST_SOURCE_LINE);
        const $lastSourceLine = getLine(FIRST_SOURCE_LINE + 1);
        expect($firstSourceLine.text()).to.be('Source line 1.');
        expect($lastSourceLine.text()).to.be('Source line 2.');
      });
    });
  });

  context('when user drags some lines far form its original place', function () {
    before(async function () {
      selectMultipleSourceLines();
      dragSelectedTextAndDropItIntoMiddleOfLine(TARGET_LINE);

      // make sure DnD was correctly simulated
      await helper.waitForPromise(() => {
        const $lineAfterTarget = getLine(TARGET_LINE + 1);
        const sourceWasMovedToTarget = $lineAfterTarget.text() !== '...';
        return sourceWasMovedToTarget;
      });
    });

    context('and user triggers UNDO', function () {
      before(async function () {
        const originalHTML = helper.padInner$('body').html();
        const $undoButton = helper.padChrome$('.buttonicon-undo');
        $undoButton.trigger('click');
        await helper.waitForPromise(() => helper.padInner$('body').html() !== originalHTML);
      });

      it('moves text back to its original place', async function () {
        // test text was removed from drop target
        const $targetLine = getLine(TARGET_LINE);
        expect($targetLine.text()).to.be('Target line []');

        // test text was added back to original place
        const $firstSourceLine = getLine(FIRST_SOURCE_LINE);
        const $lastSourceLine = getLine(FIRST_SOURCE_LINE + 1);
        expect($firstSourceLine.text()).to.be('Source line 1.');
        expect($lastSourceLine.text()).to.be('Source line 2.');
      });
    });
  });

  /* ********************* Helper functions/constants ********************* */
  const TARGET_LINE = 2;
  const FIRST_SOURCE_LINE = 5;

  const getLine = (lineNumber) => {
    const $lines = helper.padInner$('div');
    return $lines.slice(lineNumber, lineNumber + 1);
  };

  const createScriptWithSeveralLines = async () => {
    // create some lines to be used on the tests
    const $firstLine = helper.padInner$('div').first();
    $firstLine.html('...<br>...<br>Target line []<br>...<br>...<br>' +
        'Source line 1.<br>Source line 2.<br>');

    // wait for lines to be split
    await helper.waitForPromise(() => {
      const $lastSourceLine = getLine(FIRST_SOURCE_LINE + 1);
      return $lastSourceLine.text() === 'Source line 2.';
    });
  };

  const selectPartOfSourceLine = () => {
    const $sourceLine = getLine(FIRST_SOURCE_LINE);

    // select 'line 1' from 'Source line 1.'
    const start = 'Source '.length;
    const end = start + 'line 1'.length;
    helper.selectLines($sourceLine, $sourceLine, start, end);
  };
  const selectMultipleSourceLines = () => {
    const $firstSourceLine = getLine(FIRST_SOURCE_LINE);
    const $lastSourceLine = getLine(FIRST_SOURCE_LINE + 1);

    helper.selectLines($firstSourceLine, $lastSourceLine);
  };

  const dragSelectedTextAndDropItIntoMiddleOfLine = (targetLineNumber) => {
    // dragstart: start dragging content
    triggerEvent('dragstart');

    // drop: get HTML data from selected text
    const draggedHtml = getHtmlFromSelectedText();
    triggerEvent('drop');

    // dragend: remove original content + insert HTML data into target
    moveSelectionIntoTarget(draggedHtml, targetLineNumber);
    triggerEvent('dragend');
  };

  const getHtmlFromSelectedText = () => {
    const innerDocument = helper.padInner$.document;

    const range = innerDocument.getSelection().getRangeAt(0);
    const clonedSelection = range.cloneContents();
    const span = innerDocument.createElement('span');
    span.id = 'buffer';
    span.appendChild(clonedSelection);
    const draggedHtml = span.outerHTML;

    return draggedHtml;
  };

  const triggerEvent = (eventName) => {
    const event = new helper.padInner$.Event(eventName);
    helper.padInner$('#innerdocbody').trigger(event);
  };

  const moveSelectionIntoTarget = (draggedHtml, targetLineNumber) => {
    const innerDocument = helper.padInner$.document;

    // delete original content
    innerDocument.execCommand('delete');

    // set position to insert content on target line
    const $target = getLine(targetLineNumber);
    $target.sendkeys('{selectall}{rightarrow}{leftarrow}');

    // Insert content.
    // Based on http://stackoverflow.com/a/6691294, to be IE-compatible
    const range = innerDocument.getSelection().getRangeAt(0);
    const frag = innerDocument.createDocumentFragment();
    const el = innerDocument.createElement('div');
    el.innerHTML = draggedHtml;
    while (el.firstChild) {
      frag.appendChild(el.firstChild);
    }
    range.insertNode(frag);
  };
});
