'use strict';

describe('Pad modal', function () {
  context('when modal is a "force reconnect" message', function () {
    const MODAL_SELECTOR = '#connectivity';

    beforeEach(async function () {
      await helper.aNewPad();

      // force a "slowcommit" error
      helper.padChrome$.window.pad.handleChannelStateChange('DISCONNECTED', 'slowcommit');

      // wait for modal to be displayed
      const $modal = helper.padChrome$(MODAL_SELECTOR);
      await helper.waitForPromise(() => $modal.hasClass('popup-show'), 50000);
    });

    it('disables editor', async function () {
      expect(isEditorDisabled()).to.be(true);
    });

    context('and user clicks on editor', function () {
      it('does not close the modal', async function () {
        clickOnPadInner();
        const $modal = helper.padChrome$(MODAL_SELECTOR);
        const modalIsVisible = $modal.hasClass('popup-show');

        expect(modalIsVisible).to.be(true);
      });
    });

    context('and user clicks on pad outer', function () {
      it('does not close the modal', async function () {
        clickOnPadOuter();
        const $modal = helper.padChrome$(MODAL_SELECTOR);
        const modalIsVisible = $modal.hasClass('popup-show');

        expect(modalIsVisible).to.be(true);
      });
    });
  });

  // we use "settings" here, but other modals have the same behaviour
  context('when modal is not an error message', function () {
    const MODAL_SELECTOR = '#settings';

    beforeEach(async function () {
      await helper.aNewPad();
      await openSettingsAndWaitForModalToBeVisible();
    });

    // This test breaks safari testing
    xit('does not disable editor', async function () {
      expect(isEditorDisabled()).to.be(false);
    });

    context('and user clicks on editor', function () {
      it('closes the modal', async function () {
        clickOnPadInner();
        await helper.waitForPromise(() => isModalOpened(MODAL_SELECTOR) === false);
      });
    });

    context('and user clicks on pad outer', function () {
      it('closes the modal', async function () {
        clickOnPadOuter();
        await helper.waitForPromise(() => isModalOpened(MODAL_SELECTOR) === false);
      });
    });
  });

  const clickOnPadInner = () => {
    const $editor = helper.padInner$('#innerdocbody');
    $editor.trigger('click');
  };

  const clickOnPadOuter = () => {
    const $lineNumbersColumn = helper.padOuter$('#sidedivinner');
    $lineNumbersColumn.trigger('click');
  };

  const openSettingsAndWaitForModalToBeVisible = async () => {
    helper.padChrome$('.buttonicon-settings').trigger('click');

    // wait for modal to be displayed
    const modalSelector = '#settings';
    await helper.waitForPromise(() => isModalOpened(modalSelector), 10000);
  };

  const isEditorDisabled = () => {
    const editorDocument = helper.padOuter$("iframe[name='ace_inner']").get(0).contentDocument;
    const editorBody = editorDocument.getElementById('innerdocbody');

    const editorIsDisabled = editorBody.contentEditable === 'false' || // IE/Safari
                        editorDocument.designMode === 'off'; // other browsers

    return editorIsDisabled;
  };

  const isModalOpened = (modalSelector) => {
    const $modal = helper.padChrome$(modalSelector);

    return $modal.hasClass('popup-show');
  };
});
