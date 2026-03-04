'use strict';

describe('scrollTo.js', function () {
  describe('scrolls to line', function () {
    // create a new pad with URL hash set before each test run
    before(async function () {
      await helper.aNewPad({hash: 'L4'});
    });

    it('Scrolls down to Line 4', async function () {
      const chrome$ = helper.padChrome$;
      await helper.waitForPromise(() => {
        const topOffset = parseInt(chrome$('iframe').first('iframe')
            .contents().find('#outerdocbody').css('top'));
        return (topOffset >= 100);
      });
    });
  });

  describe('doesnt break on weird hash input', function () {
    // create a new pad with URL hash set before each test run
    before(async function () {
      await helper.aNewPad({hash: '#DEEZ123123NUTS'});
    });

    it('Does NOT change scroll', async function () {
      const chrome$ = helper.padChrome$;
      await helper.waitForPromise(() => {
        const topOffset = parseInt(chrome$('iframe').first('iframe')
            .contents().find('#outerdocbody').css('top'));
        return (!topOffset); // no css top should be set.
      });
    });
  });
});
