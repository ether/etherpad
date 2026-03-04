'use strict';

describe('timeslider', function () {
  const padId = 735773577357 + (Math.round(Math.random() * 1000));

  // create a new pad before each test run
  beforeEach(async function () {
    await helper.aNewPad({id: padId});
  });

  it('Makes sure the export URIs are as expected when the padID is numeric', async function () {
    await helper.edit('a\n');

    await helper.gotoTimeslider(1);

    // ensure we are on revision 1
    await helper.waitForPromise(() => helper.contentWindow().location.hash === '#1');

    // expect URI to be similar to
    // http://192.168.1.48:9001/p/2/1/export/html
    // http://192.168.1.48:9001/p/735773577399/1/export/html
    const rev1ExportLink = helper.contentWindow().$('#exporthtmla').attr('href');
    expect(rev1ExportLink).to.contain('/1/export/html');

    // Click somewhere left on the timeslider to go to revision 0
    helper.sliderClick(30);

    const rev0ExportLink = helper.contentWindow().$('#exporthtmla').attr('href');
    expect(rev0ExportLink).to.contain('/0/export/html');
  });
});
