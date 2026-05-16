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

    it('reapplies the scroll when earlier content changes height after load', async function () {
      const chrome$ = helper.padChrome$;
      const inner$ = helper.padInner$;
      const getTopOffset = () => parseInt(chrome$('iframe').first('iframe')
          .contents().find('#outerdocbody').css('top')) || 0;

      await helper.waitForPromise(() => getTopOffset() >= 100);
      const initialTopOffset = getTopOffset();

      inner$('#innerdocbody > div').first().css('height', '400px');

      await helper.waitForPromise(() => getTopOffset() > initialTopOffset + 200);
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
