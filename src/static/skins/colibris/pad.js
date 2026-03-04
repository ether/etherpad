'use strict';

const MAX_PADS_IN_HISTORY = 3;

window.customStart = () => {
  $('#pad_title').show();
  $('.buttonicon').on('mousedown', function () { $(this).parent().addClass('pressed'); });
  $('.buttonicon').on('mouseup', function () { $(this).parent().removeClass('pressed'); });

  const pathSegments = window.location.pathname.split('/');
  const padName = pathSegments[pathSegments.length - 1];
  const recentPads = localStorage.getItem('recentPads');
  if (recentPads == null) {
    localStorage.setItem('recentPads', JSON.stringify([]));
  }
  const recentPadsList = JSON.parse(localStorage.getItem('recentPads'));
  if (!recentPadsList.some((pad) => pad.name === padName)) {
    if (recentPadsList.length >= MAX_PADS_IN_HISTORY) {
      recentPadsList.shift(); // Remove the oldest pad if we have more than 10
    }
    recentPadsList.push({
      name: padName,
      timestamp: new Date().toISOString(), // Store the timestamp for sorting
      members: 1,
    });
    localStorage.setItem('recentPads', JSON.stringify(recentPadsList));
  } else {
    // Update the timestamp if the pad already exists
    const existingPad = recentPadsList.find((pad) => pad.name === padName);
    if (existingPad) {
      existingPad.timestamp = new Date().toISOString();
    }
    localStorage.setItem('recentPads', JSON.stringify(recentPadsList));
  }
};
