'use strict';

describe('Automatic pad reload on Force Reconnect message', function () {
  let padId, $originalPadFrame;

  beforeEach(async function () {
    padId = await helper.aNewPad();

    // enable userdup error to have timer to force reconnect
    const $errorMessageModal = helper.padChrome$('#connectivity .userdup');
    $errorMessageModal.addClass('with_reconnect_timer');

    // make sure there's a timeout set, otherwise automatic reconnect won't be enabled
    helper.padChrome$.window.clientVars.automaticReconnectionTimeout = 2;

    // open same pad on another iframe, to force userdup error
    const $otherIframeWithSamePad = $(`<iframe src="/p/${padId}" style="height: 1px;"></iframe>`);
    $originalPadFrame = $('#iframe-container iframe');
    $otherIframeWithSamePad.insertAfter($originalPadFrame);

    // wait for modal to be displayed
    await helper.waitForPromise(() => $errorMessageModal.is(':visible'), 50000);
  });

  it('displays a count down timer to automatically reconnect', async function () {
    const $errorMessageModal = helper.padChrome$('#connectivity .userdup');
    const $countDownTimer = $errorMessageModal.find('.reconnecttimer');

    expect($countDownTimer.is(':visible')).to.be(true);
  });

  context('and user clicks on Cancel', function () {
    beforeEach(async function () {
      const $errorMessageModal = helper.padChrome$('#connectivity .userdup');
      $errorMessageModal.find('#cancelreconnect').trigger('click');
      await helper.waitForPromise(
          () => helper.padChrome$('#connectivity .userdup').is(':visible') === true);
    });

    it('does not show Cancel button nor timer anymore', async function () {
      const $errorMessageModal = helper.padChrome$('#connectivity .userdup');
      const $countDownTimer = $errorMessageModal.find('.reconnecttimer');
      const $cancelButton = $errorMessageModal.find('#cancelreconnect');

      expect($countDownTimer.is(':visible')).to.be(false);
      expect($cancelButton.is(':visible')).to.be(false);
    });
  });

  context('and user does not click on Cancel until timer expires', function () {
    it('reloads the pad', async function () {
      this.timeout(10000);
      await new Promise((resolve) => $originalPadFrame.one('load', resolve));
    });
  });
});
