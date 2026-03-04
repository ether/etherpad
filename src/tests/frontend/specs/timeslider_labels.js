'use strict';

describe('timeslider', function () {
  // create a new pad before each test run
  beforeEach(async function () {
    await helper.aNewPad();
  });

  /**
   * @todo test authorsList
   */
  it("Shows a date/time in the timeslider and make sure it doesn't include NaN", async function () {
    this.timeout(12000);
    // make some changes to produce 3 revisions
    const revs = 3;

    for (let i = 0; i < revs; i++) {
      await helper.edit('a\n');
    }

    await helper.gotoTimeslider(revs);
    await helper.waitForPromise(() => helper.contentWindow().location.hash === `#${revs}`);

    // the datetime of last edit
    const timerTimeLast = new Date(helper.timesliderTimerTime()).getTime();

    // the day of this revision, e.g. August 12, 2020 (stripped the string "Saved")
    const dateLast = new Date(helper.revisionDateElem().substr(6)).getTime();

    // the label/revision, ie Version 3
    const labelLast = helper.revisionLabelElem().text();

    // the datetime should be a date
    expect(Number.isNaN(timerTimeLast)).to.eql(false);

    // the Date object of the day should not be NaN
    expect(Number.isNaN(dateLast)).to.eql(false);

    // the label should be Version `Number`
    expect(labelLast).to.be(`Version ${revs}`);

    // Click somewhere left on the timeslider to go to revision 0
    helper.sliderClick(1);

    // the datetime of last edit
    const timerTime = new Date(helper.timesliderTimerTime()).getTime();

    // the day of this revision, e.g. August 12, 2020
    const date = new Date(helper.revisionDateElem().substr(6)).getTime();

    // the label/revision, e.g. Version 0
    const label = helper.revisionLabelElem().text();

    // the datetime should be a date
    expect(Number.isNaN(timerTime)).to.eql(false);
    // the last revision should be newer or have the same time
    expect(timerTimeLast).to.not.be.lessThan(timerTime);

    // the Date object of the day should not be NaN
    expect(Number.isNaN(date)).to.eql(false);

    // the label should be Version 0
    expect(label).to.be('Version 0');
  });
});
