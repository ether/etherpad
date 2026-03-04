'use strict';

describe('chat-load-messages', function () {
  let padName;

  it('creates a pad', async function () {
    padName = await helper.aNewPad();
  });

  it('adds a lot of messages', async function () {
    const chrome$ = helper.padChrome$;
    const chatButton = chrome$('#chaticon');
    chatButton.trigger('click');
    const chatInput = chrome$('#chatinput');
    const chatText = chrome$('#chattext');

    const messages = 140;
    for (let i = 1; i <= messages; i++) {
      let num = `${i}`;
      if (num.length === 1) num = `00${num}`;
      if (num.length === 2) num = `0${num}`;
      chatInput.sendkeys(`msg${num}`);
      chatInput.sendkeys('{enter}');
      await helper.waitForPromise(() => chatText.children('p').length === i);
    }
    await helper.aNewPad({id: padName});
  });

  it('checks initial message count', function (done) {
    this.timeout(1000);
    let chatText;
    const expectedCount = 101;
    const chrome$ = helper.padChrome$;
    helper.waitFor(() => {
      const chatButton = chrome$('#chaticon');
      chatButton.trigger('click');
      chatText = chrome$('#chattext');
      return chatText.children('p').length === expectedCount;
    }).always(() => {
      expect(chatText.children('p').length).to.be(expectedCount);
      done();
    });
  });

  it('loads more messages', function (done) {
    this.timeout(3000);
    const expectedCount = 122;
    const chrome$ = helper.padChrome$;
    const chatButton = chrome$('#chaticon');
    chatButton.trigger('click');
    const chatText = chrome$('#chattext');
    const loadMsgBtn = chrome$('#chatloadmessagesbutton');

    loadMsgBtn.trigger('click');
    helper.waitFor(() => chatText.children('p').length === expectedCount).always(() => {
      expect(chatText.children('p').length).to.be(expectedCount);
      done();
    });
  });

  it('checks for button vanishing', function (done) {
    this.timeout(2000);
    const expectedDisplay = 'none';
    const chrome$ = helper.padChrome$;
    const chatButton = chrome$('#chaticon');
    chatButton.trigger('click');
    const loadMsgBtn = chrome$('#chatloadmessagesbutton');
    const loadMsgBall = chrome$('#chatloadmessagesball');

    loadMsgBtn.trigger('click');
    helper.waitFor(() => loadMsgBtn.css('display') === expectedDisplay &&
             loadMsgBall.css('display') === expectedDisplay).always(() => {
      expect(loadMsgBtn.css('display')).to.be(expectedDisplay);
      expect(loadMsgBall.css('display')).to.be(expectedDisplay);
      done();
    });
  });
});
