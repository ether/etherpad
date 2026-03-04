// @ts-nocheck
'use strict';

/**
 * the contentWindow is either the normal pad or timeslider
 *
 * @returns {HTMLElement} contentWindow
 */
helper.contentWindow = () => $('#iframe-container iframe')[0].contentWindow;

/**
 * Opens the chat unless it is already open via an
 * icon on the bottom right of the page
 *
 * @returns {Promise}
 */
helper.showChat = async () => {
  const chaticon = helper.chatIcon();
  if (!chaticon.hasClass('visible')) return;
  chaticon.trigger('click');
  await helper.waitForPromise(() => !chaticon.hasClass('visible'), 2000);
};

/**
 * Closes the chat window if it is shown and not sticky
 *
 * @returns {Promise}
 */
helper.hideChat = async () => {
  if (!helper.isChatboxShown() || helper.isChatboxSticky()) return;
  helper.titlecross().trigger('click');
  await helper.waitForPromise(() => !helper.isChatboxShown(), 2000);
};

/**
 * Gets the chat icon from the bottom right of the page
 *
 * @returns {HTMLElement} the chat icon
 */
helper.chatIcon = () => helper.padChrome$('#chaticon');

/**
 * The chat messages from the UI
 *
 * @returns {Array.<HTMLElement>}
 */
helper.chatTextParagraphs = () => helper.padChrome$('#chattext').children('p');

/**
 * Returns true if the chat box is sticky
 *
 * @returns {boolean} stickyness of the chat box
 */
helper.isChatboxSticky = () => helper.padChrome$('#chatbox').hasClass('stickyChat');

/**
 * Returns true if the chat box is shown
 *
 * @returns {boolean} visibility of the chat box
 */
helper.isChatboxShown = () => helper.padChrome$('#chatbox').hasClass('visible');

/**
 * Gets the settings menu
 *
 * @returns {HTMLElement} the settings menu
 */
helper.settingsMenu = () => helper.padChrome$('#settings');

/**
 * Gets the settings button
 *
 * @returns {HTMLElement} the settings button
 */
helper.settingsButton =
    () => helper.padChrome$("button[data-l10n-id='pad.toolbar.settings.title']");

/**
 * Toggles user list
 */
helper.toggleUserList = async () => {
  const isVisible = helper.userListShown();
  const button = helper.padChrome$("button[data-l10n-id='pad.toolbar.showusers.title']");
  button.trigger('click');
  await helper.waitForPromise(() => !isVisible);
};

/**
 * Gets the user name input field
 *
 * @returns {HTMLElement} user name input field
 */
helper.usernameField = () => helper.padChrome$("input[data-l10n-id='pad.userlist.entername']");

/**
 * Is the user list popup shown?
 *
 * @returns {boolean}
 */
helper.userListShown = () => helper.padChrome$('div#users').hasClass('popup-show');

/**
 * Sets the user name
 *
 */
helper.setUserName = async (name) => {
  const userElement = helper.usernameField();
  userElement.trigger('click');
  userElement.val(name);
  userElement.trigger('blur');
  await helper.waitForPromise(() => !helper.usernameField().hasClass('editactive'));
};

/**
 * Gets the titlecross icon
 *
 * @returns {HTMLElement} the titlecross icon
 */
helper.titlecross = () => helper.padChrome$('#titlecross');

/**
 * Returns true if the settings menu is visible
 *
 * @returns {boolean} is the settings menu shown?
 */
helper.isSettingsShown = () => helper.padChrome$('#settings').hasClass('popup-show');

/**
 * Gets the timer div of a timeslider that has the datetime of the revision
 *
 * @returns {HTMLElement} timer
 */
helper.timesliderTimer = () => {
  if (typeof helper.contentWindow().$ !== 'function') return;
  return helper.contentWindow().$('#timer');
};

/**
 * Gets the time of the revision on a timeslider
 *
 * @returns {HTMLElement} timer
 */
helper.timesliderTimerTime = () => {
  if (!helper.timesliderTimer()) return;
  return helper.timesliderTimer().text();
};

/**
 * The ui-slidar-bar element in the timeslider
 *
 * @returns {HTMLElement}
 */
helper.sliderBar = () => helper.contentWindow().$('#ui-slider-bar');

/**
 * revision_date element
 * like "Saved October 10, 2020"
 *
 * @returns {HTMLElement}
 */
helper.revisionDateElem = () => helper.contentWindow().$('#revision_date').text();

/**
 * revision_label element
 * like "Version 1"
 *
 * @returns {HTMLElement}
 */
helper.revisionLabelElem = () => helper.contentWindow().$('#revision_label');
