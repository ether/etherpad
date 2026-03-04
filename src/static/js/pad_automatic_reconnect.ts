// @ts-nocheck
'use strict';
import html10n from './vendors/html10n';

exports.showCountDownTimerToReconnectOnModal = ($modal, pad) => {
  if (clientVars.automaticReconnectionTimeout && $modal.is('.with_reconnect_timer')) {
    createCountDownElementsIfNecessary($modal);

    const timer = createTimerForModal($modal, pad);

    $modal.find('#cancelreconnect').one('click', () => {
      timer.cancel();
      disableAutomaticReconnection($modal);
    });

    enableAutomaticReconnection($modal);
  }
};

const createCountDownElementsIfNecessary = ($modal) => {
  const elementsDoNotExist = $modal.find('#cancelreconnect').length === 0;
  if (elementsDoNotExist) {
    const $defaultMessage = $modal.find('#defaulttext');
    const $reconnectButton = $modal.find('#forcereconnect');

    // create extra DOM elements, if they don't exist
    const $reconnectTimerMessage =
        $('<p>')
            .addClass('reconnecttimer')
            .append(
                $('<span>')
                    .attr('data-l10n-id', 'pad.modals.reconnecttimer')
                    .text('Trying to reconnect in'))
            .append(' ')
            .append(
                $('<span>')
                    .addClass('timetoexpire'));
    const $cancelReconnect =
        $('<button>')
            .attr('id', 'cancelreconnect')
            .attr('data-l10n-id', 'pad.modals.cancel')
            .text('Cancel');

    localize($reconnectTimerMessage);
    localize($cancelReconnect);

    $reconnectTimerMessage.insertAfter($defaultMessage);
    $cancelReconnect.insertAfter($reconnectButton);
  }
};

const localize = ($element) => {
  html10n.translateElement(html10n.translations, $element.get(0));
};

const createTimerForModal = ($modal, pad) => {
  const timeUntilReconnection =
      clientVars.automaticReconnectionTimeout * reconnectionTries.nextTry();
  const timer = new CountDownTimer(timeUntilReconnection);

  timer.onTick((minutes, seconds) => {
    updateCountDownTimerMessage($modal, minutes, seconds);
  }).onExpire(() => {
    const wasANetworkError = $modal.is('.disconnected');
    if (wasANetworkError) {
      // cannot simply reconnect, client is having issues to establish connection to server
      waitUntilClientCanConnectToServerAndThen(() => { forceReconnection($modal); }, pad);
    } else {
      forceReconnection($modal);
    }
  }).start();

  return timer;
};

const disableAutomaticReconnection = ($modal) => {
  toggleAutomaticReconnectionOption($modal, true);
};
const enableAutomaticReconnection = ($modal) => {
  toggleAutomaticReconnectionOption($modal, false);
};
const toggleAutomaticReconnectionOption = ($modal, disableAutomaticReconnect) => {
  $modal.find('#cancelreconnect, .reconnecttimer').toggleClass('hidden', disableAutomaticReconnect);
  $modal.find('#defaulttext').toggleClass('hidden', !disableAutomaticReconnect);
};

const waitUntilClientCanConnectToServerAndThen = (callback, pad) => {
  whenConnectionIsRestablishedWithServer(callback, pad);
  pad.socket.connect();
};

const whenConnectionIsRestablishedWithServer = (callback, pad) => {
  // only add listener for the first try, don't need to add another listener
  // on every unsuccessful try
  if (reconnectionTries.counter === 1) {
    pad.socket.once('connect', callback);
  }
};

const forceReconnection = ($modal) => {
  $modal.find('#forcereconnect').trigger('click');
};

const updateCountDownTimerMessage = ($modal, minutes, seconds) => {
  minutes = minutes < 10 ? `0${minutes}` : minutes;
  seconds = seconds < 10 ? `0${seconds}` : seconds;

  $modal.find('.timetoexpire').text(`${minutes}:${seconds}`);
};

// store number of tries to reconnect to server, in order to increase time to wait
// until next try
const reconnectionTries = {
  counter: 0,

  nextTry() {
    // double the time to try to reconnect on every time reconnection fails
    const nextCounterFactor = 2 ** this.counter;
    this.counter++;

    return nextCounterFactor;
  },
};

// Timer based on http://stackoverflow.com/a/20618517.
// duration: how many **seconds** until the timer ends
// granularity (optional): how many **milliseconds**
// between each 'tick' of timer. Default: 1000ms (1s)
const CountDownTimer = function (duration, granularity) {
  this.duration = duration;
  this.granularity = granularity || 1000;
  this.running = false;

  this.onTickCallbacks = [];
  this.onExpireCallbacks = [];
};

CountDownTimer.prototype.start = function () {
  if (this.running) {
    return;
  }
  this.running = true;
  const start = Date.now();
  const that = this;
  let diff;
  const timer = () => {
    diff = that.duration - Math.floor((Date.now() - start) / 1000);

    if (diff > 0) {
      that.timeoutId = setTimeout(timer, that.granularity);
      that.tick(diff);
    } else {
      that.running = false;
      that.tick(0);
      that.expire();
    }
  };
  timer();
};

CountDownTimer.prototype.tick = function (diff) {
  const obj = CountDownTimer.parse(diff);
  this.onTickCallbacks.forEach(function (callback) {
    callback.call(this, obj.minutes, obj.seconds);
  }, this);
};
CountDownTimer.prototype.expire = function () {
  this.onExpireCallbacks.forEach(function (callback) {
    callback.call(this);
  }, this);
};

CountDownTimer.prototype.onTick = function (callback) {
  if (typeof callback === 'function') {
    this.onTickCallbacks.push(callback);
  }
  return this;
};

CountDownTimer.prototype.onExpire = function (callback) {
  if (typeof callback === 'function') {
    this.onExpireCallbacks.push(callback);
  }
  return this;
};

CountDownTimer.prototype.cancel = function () {
  this.running = false;
  clearTimeout(this.timeoutId);
  return this;
};

CountDownTimer.parse = (seconds) => ({
  minutes: (seconds / 60) | 0,
  seconds: (seconds % 60) | 0,
});
