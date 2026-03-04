// @ts-nocheck

/**
 * Spys on socket.io messages and saves them into several arrays
 * that are visible in tests
 */
helper.spyOnSocketIO = () => {
  helper.contentWindow().pad.socket.on('message', (msg) => {
    if (msg.type !== 'COLLABROOM') return;
    if (msg.data.type === 'ACCEPT_COMMIT') {
      helper.commits.push(msg);
    } else if (msg.data.type === 'USER_NEWINFO') {
      helper.userInfos.push(msg);
    } else if (msg.data.type === 'CHAT_MESSAGE') {
      helper.chatMessages.push(msg.data.message);
    } else if (msg.data.type === 'CHAT_MESSAGES') {
      helper.chatMessages.push(...msg.data.messages);
    }
  });
};

/**
 * Makes an edit via `sendkeys` to the position of the caret and ensures ACCEPT_COMMIT
 * is returned by the server
 * It does not check if the ACCEPT_COMMIT is the edit sent, though
 * If `line` is not given, the edit goes to line no. 1
 *
 * @param {string} message The edit to make - can be anything supported by `sendkeys`
 * @param {number} [line] the optional line to make the edit on starting from 1
 * @returns {Promise}
 * @todo needs to support writing to a specified caret position
 *
 */
helper.edit = async (message, line) => {
  const editsNum = helper.commits.length;
  line = line ? line - 1 : 0;
  await helper.withFastCommit(async (incorp) => {
    helper.linesDiv()[line].sendkeys(message);
    incorp();
    await helper.waitForPromise(() => editsNum + 1 === helper.commits.length, 10000);
  });
};

/**
 * The pad text as an array of divs
 *
 * @example
 * helper.linesDiv()[2].sendkeys('abc') // sends abc to the third line
 *
 * @returns {Array.<HTMLElement>} array of divs
 */
helper.linesDiv = () => helper.padInner$('.ace-line').map(function () { return $(this); }).get();

/**
 * The pad text as an array of lines
 * For lines in timeslider use `helper.timesliderTextLines()`
 *
 * @returns {Array.<string>} lines of text
 */
helper.textLines = () => helper.linesDiv().map((div) => div.text());

/**
 * The default pad text transmitted via `clientVars`
 *
 * @returns {string}
 */
helper.defaultText =
    () => helper.padChrome$.window.clientVars.collab_client_vars.initialAttributedText.text;

/**
 * Sends a chat `message` via `sendKeys`
 * You *must* include `{enter}` at the end of the string or it will
 * just fill the input field but not send the message.
 *
 * @todo Cannot send multiple messages at once
 *
 * @example
 *
 * `helper.sendChatMessage('hi{enter}')`
 *
 * @param {string} message the chat message to be sent
 * @returns {Promise}
 */
helper.sendChatMessage = async (message) => {
  const noOfChatMessages = helper.chatMessages.length;
  helper.padChrome$('#chatinput').sendkeys(message);
  await helper.waitForPromise(() => noOfChatMessages + 1 === helper.chatMessages.length);
};

/**
 * Opens the settings menu if its hidden via button
 *
 * @returns {Promise}
 */
helper.showSettings = async () => {
  if (helper.isSettingsShown()) return;
  helper.settingsButton().trigger('click');
  await helper.waitForPromise(() => helper.isSettingsShown(), 2000);
};

/**
 * Hide the settings menu if its open via button
 *
 * @returns {Promise}
 * @todo untested
 */
helper.hideSettings = async () => {
  if (!helper.isSettingsShown()) return;
  helper.settingsButton().trigger('click');
  await helper.waitForPromise(() => !helper.isSettingsShown(), 2000);
};

/**
 * Makes the chat window sticky via settings menu if the settings menu is
 * open and sticky button is not checked
 *
 * @returns {Promise}
 */
helper.enableStickyChatviaSettings = async () => {
  const stickyChat = helper.padChrome$('#options-stickychat');
  if (!helper.isSettingsShown() || stickyChat.is(':checked')) return;
  stickyChat.trigger('click');
  await helper.waitForPromise(() => helper.isChatboxSticky(), 2000);
};

/**
 * Unsticks the chat window via settings menu if the settings menu is open
 * and sticky button is checked
 *
 * @returns {Promise}
 */
helper.disableStickyChatviaSettings = async () => {
  const stickyChat = helper.padChrome$('#options-stickychat');
  if (!helper.isSettingsShown() || !stickyChat.is(':checked')) return;
  stickyChat.trigger('click');
  await helper.waitForPromise(() => !helper.isChatboxSticky(), 2000);
};

/**
 * Makes the chat window sticky via an icon on the top right of the chat
 * window
 *
 * @returns {Promise}
 */
helper.enableStickyChatviaIcon = async () => {
  const stickyChat = helper.padChrome$('#titlesticky');
  if (!helper.isChatboxShown() || helper.isChatboxSticky()) return;
  stickyChat.trigger('click');
  await helper.waitForPromise(() => helper.isChatboxSticky(), 2000);
};

/**
 * Disables the stickyness of the chat window via an icon on the
 * upper right
 *
 * @returns {Promise}
 */
helper.disableStickyChatviaIcon = async () => {
  if (!helper.isChatboxShown() || !helper.isChatboxSticky()) return;
  helper.titlecross().trigger('click');
  await helper.waitForPromise(() => !helper.isChatboxSticky(), 2000);
};

/**
 * Sets the src-attribute of the main iframe to the timeslider
 * In case a revision is given, sets the timeslider to this specific revision.
 * Defaults to going to the last revision.
 * It waits until the timer is filled with date and time, because it's one of the
 * last things that happen during timeslider load
 *
 * @param {number} [revision] the optional revision
 * @returns {Promise}
 * @todo for some reason this does only work the first time, you cannot
 * goto rev 0 and then via the same method to rev 5. Use buttons instead
 */
helper.gotoTimeslider = async (revision) => {
  revision = Number.isInteger(revision) ? `#${revision}` : '';
  helper.padChrome$.window.location.href =
      `${helper.padChrome$.window.location.pathname}/timeslider${revision}`;
  await helper.waitForPromise(() => helper.timesliderTimerTime() &&
      !Number.isNaN(new Date(helper.timesliderTimerTime()).getTime()), 10000);
};

/**
 * Clicks in the timeslider at a specific offset
 * It's used to navigate the timeslider
 *
 * @todo no mousemove test
 * @param {number} X coordinate
 */
helper.sliderClick = (X) => {
  const sliderBar = helper.sliderBar();
  const edown = new jQuery.Event('mousedown');
  const eup = new jQuery.Event('mouseup');
  edown.clientX = eup.clientX = X;
  edown.clientY = eup.clientY = sliderBar.offset().top;

  sliderBar.trigger(edown);
  sliderBar.trigger(eup);
};

/**
 * The timeslider text as an array of lines
 *
 * @returns {Array.<string>} lines of text
 */
helper.timesliderTextLines = () => helper.contentWindow().$('.ace-line').map(function () {
  return $(this).text();
}).get();

helper.padIsEmpty = () => (
  !helper.padInner$.document.getSelection().isCollapsed ||
  (helper.padInner$('div').length === 1 && helper.padInner$('div').first().html() === '<br>'));

helper.clearPad = async () => {
  if (helper.padIsEmpty()) return;
  const commitsBefore = helper.commits.length;
  const lines = helper.linesDiv();
  helper.selectLines(lines[0], lines[lines.length - 1]);
  await helper.waitForPromise(() => !helper.padInner$.document.getSelection().isCollapsed);
  const e = new helper.padInner$.Event(helper.evtType);
  e.keyCode = 8; // delete key
  await helper.withFastCommit(async (incorp) => {
    helper.padInner$('#innerdocbody').trigger(e);
    incorp();
    await helper.waitForPromise(helper.padIsEmpty);
    await helper.waitForPromise(() => helper.commits.length > commitsBefore);
  });
};
