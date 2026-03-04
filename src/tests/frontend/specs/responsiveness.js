'use strict';

// Test for https://github.com/ether/etherpad-lite/issues/1763

// This test fails in Opera, IE and Safari
// Opera fails due to a weird way of handling the order of execution,
// yet actual performance seems fine
// Safari fails due the delay being too great yet the actual performance seems fine
// Firefox might panic that the script is taking too long so will fail
// IE will fail due to running out of memory as it can't fit 2M chars in memory.

// Just FYI Google Docs crashes on large docs whilst trying to Save,
// it's likely the limitations we are
// experiencing are more to do with browser limitations than improper implementation.
// A ueber fix for this would be to have a separate lower cpu priority
// thread that handles operations that aren't
// visible to the user.

// Adapted from John McLear's original test case.

xdescribe('Responsiveness of Editor', function () {
  // create a new pad before each test run
  beforeEach(async function () {
    this.timeout(6000);
    await helper.aNewPad();
  });

  // JM commented out on 8th Sep 2020 for a release, after release this needs uncommenting
  // And the test needs to be fixed to work in Firefox 52 on Windows 7.
  // I am not sure why it fails on this specific platform
  // The errors show this.timeout... then crash the browser but
  // I am sure something is actually causing the stack trace and
  // I just need to narrow down what, offers to help accepted.
  it('Fast response to keypress in pad with large amount of contents', async function () {
    // skip on Windows Firefox 52.0
    if (window.bowser &&
        window.bowser.windows && window.bowser.firefox && window.bowser.version === '52.0') {
      this.skip();
    }
    const inner$ = helper.padInner$;
    const chars = '0000000000'; // row of placeholder chars
    const amount = 200000; // number of blocks of chars we will insert
    const length = (amount * (chars.length) + 1); // include a counter for each space
    let text = ''; // the text we're gonna insert
    this.timeout(amount * 150); // Changed from 100 to 150 to allow Mac OSX Safari to be slow.

    // get keys to send
    const keyMultiplier = 10; // multiplier * 10 == total number of key events
    let keysToSend = '';
    for (let i = 0; i <= keyMultiplier; i++) {
      keysToSend += chars;
    }

    const textElement = inner$('div');
    textElement.sendkeys('{selectall}'); // select all
    textElement.sendkeys('{del}'); // clear the pad text

    for (let i = 0; i <= amount; i++) {
      text = `${text + chars} `; // add the chars and space to the text contents
    }
    inner$('div').first().text(text); // Put the text contents into the pad

    // Wait for the new contents to be on the pad
    await helper.waitForPromise(() => inner$('div').text().length > length, 10000);

    // has the text changed?
    expect(inner$('div').text().length).to.be.greaterThan(length);
    const start = Date.now(); // get the start time

    // send some new text to the screen (ensure all 3 key events are sent)
    const el = inner$('div').first();
    for (let i = 0; i < keysToSend.length; ++i) {
      const x = keysToSend.charCodeAt(i);
      ['keyup', 'keypress', 'keydown'].forEach((type) => {
        const e = new $.Event(type);
        e.keyCode = x;
        el.trigger(e);
      });
    }

    await helper.waitForPromise(() => { // Wait for the ability to process
      const el = inner$('body');
      if (el[0].textContent.length > amount) return true;
    }, 5000);

    const end = Date.now(); // get the current time
    const delay = end - start; // get the delay as the current time minus the start time

    expect(delay).to.be.below(600);
  });
});
