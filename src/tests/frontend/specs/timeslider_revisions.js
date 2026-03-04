'use strict';

describe('timeslider', function () {
  // create a new pad before each test run
  beforeEach(async function () {
    await helper.aNewPad();
  });

  it('loads adds a hundred revisions', async function () {
    this.timeout(100000);
    const chrome$ = helper.padChrome$;

    // Create a bunch of revisions.
    for (let i = 0; i < 99; i++) await helper.edit('a');
    chrome$('.buttonicon-savedRevision').trigger('click');
    await helper.waitForPromise(() => helper.padChrome$('.saved-revision').length > 0);
    // Give some time to send the SAVE_REVISION message to the server before navigating away.
    await new Promise((resolve) => setTimeout(resolve, 100));

    // go to timeslider
    $('#iframe-container iframe')
        .attr('src', `${$('#iframe-container iframe').attr('src')}/timeslider`);

    await new Promise((resolve) => setTimeout(resolve, 6000));

    const timeslider$ = $('#iframe-container iframe')[0].contentWindow.$;
    const $sliderBar = timeslider$('#ui-slider-bar');

    const latestContents = timeslider$('#innerdocbody').text();

    // Click somewhere on the timeslider
    let e = new jQuery.Event('mousedown');
    // sets y co-ordinate of the pad slider modal.
    const base = (timeslider$('#ui-slider-bar').offset().top - 24);
    e.clientX = e.pageX = 150;
    e.clientY = e.pageY = base + 5;
    $sliderBar.trigger(e);

    e = new jQuery.Event('mousedown');
    e.clientX = e.pageX = 150;
    e.clientY = e.pageY = base;
    $sliderBar.trigger(e);

    e = new jQuery.Event('mousedown');
    e.clientX = e.pageX = 150;
    e.clientY = e.pageY = base - 5;
    $sliderBar.trigger(e);

    $sliderBar.trigger('mouseup');

    await new Promise((resolve) => setTimeout(resolve, 1000));

    // make sure the text has changed
    expect(timeslider$('#innerdocbody').text()).not.to.eql(latestContents);
    const starIsVisible = timeslider$('.star').is(':visible');
    expect(starIsVisible).to.eql(true);
  });


  // Disabled as jquery trigger no longer works properly
  xit('changes the url when clicking on the timeslider', async function () {
    // Create some revisions.
    for (let i = 0; i < 20; i++) await helper.edit('a');

    // go to timeslider
    $('#iframe-container iframe')
        .attr('src', `${$('#iframe-container iframe').attr('src')}/timeslider`);

    await new Promise((resolve) => setTimeout(resolve, 6000));

    const timeslider$ = $('#iframe-container iframe')[0].contentWindow.$;
    const $sliderBar = timeslider$('#ui-slider-bar');

    const oldUrl = $('#iframe-container iframe')[0].contentWindow.location.hash;

    // Click somewhere on the timeslider
    const e = new jQuery.Event('mousedown');
    e.clientX = e.pageX = 150;
    e.clientY = e.pageY = 60;
    $sliderBar.trigger(e);

    await helper.waitForPromise(
        () => $('#iframe-container iframe')[0].contentWindow.location.hash !== oldUrl, 6000);
  });

  it('jumps to a revision given in the url', async function () {
    const inner$ = helper.padInner$;
    this.timeout(40000);

    // wait for the text to be loaded
    await helper.waitForPromise(() => inner$('body').text().length !== 0, 10000);

    const newLines = inner$('body div').length;
    const oldLength = inner$('body').text().length + newLines / 2;
    expect(oldLength).to.not.eql(0);
    inner$('div').first().sendkeys('a');
    let timeslider$;

    // wait for our additional revision to be added
    await helper.waitForPromise(() => {
      // newLines takes the new lines into account which are strippen when using
      // inner$('body').text(), one <div> is used for one line in ACE.
      const lenOkay = inner$('body').text().length + newLines / 2 !== oldLength;
      // this waits for the color to be added to our <span>, which means that the revision
      // was accepted by the server.
      const colorOkay = inner$('span').first().attr('class').indexOf('author-') === 0;
      return lenOkay && colorOkay;
    }, 10000);

    // go to timeslider with a specific revision set
    $('#iframe-container iframe')
        .attr('src', `${$('#iframe-container iframe').attr('src')}/timeslider#0`);

    // wait for the timeslider to be loaded
    await helper.waitForPromise(() => {
      try {
        timeslider$ = $('#iframe-container iframe')[0].contentWindow.$;
      } catch (e) {
        // Empty catch block <3
      }
      return timeslider$ && timeslider$('#innerdocbody').text().length === oldLength;
    }, 10000);
  });

  it('checks the export url', async function () {
    const inner$ = helper.padInner$;
    this.timeout(11000);
    inner$('div').first().sendkeys('a');

    await new Promise((resolve) => setTimeout(resolve, 2500));

    // go to timeslider
    $('#iframe-container iframe')
        .attr('src', `${$('#iframe-container iframe').attr('src')}/timeslider#0`);
    let timeslider$;
    let exportLink;

    await helper.waitForPromise(() => {
      try {
        timeslider$ = $('#iframe-container iframe')[0].contentWindow.$;
      } catch (e) {
        // Empty catch block <3
      }
      if (!timeslider$) return false;
      exportLink = timeslider$('#exportplaina').attr('href');
      if (!exportLink) return false;
      return exportLink.substr(exportLink.length - 12) === '0/export/txt';
    }, 6000);
  });
});
