// @ts-nocheck
'use strict';

/**
 * Copyright 2009 Google Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS-IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import padutils from './pad_utils'
const hooks = require('./pluginfw/hooks');
import html10n from './vendors/html10n';
let myUserInfo = {};

let colorPickerOpen = false;
let colorPickerSetup = false;

const paduserlist = (() => {
  const rowManager = (() => {
    // The row manager handles rendering rows of the user list and animating
    // their insertion, removal, and reordering.  It manipulates TD height
    // and TD opacity.

    const nextRowId = () => `usertr${nextRowId.counter++}`;
    nextRowId.counter = 1;
    // objects are shared; fields are "domId","data","animationStep"
    const rowsFadingOut = []; // unordered set
    const rowsFadingIn = []; // unordered set
    const rowsPresent = []; // in order
    const ANIMATION_START = -12; // just starting to fade in
    const ANIMATION_END = 12; // just finishing fading out

    const animateStep = () => {
      // animation must be symmetrical
      for (let i = rowsFadingIn.length - 1; i >= 0; i--) { // backwards to allow removal
        const row = rowsFadingIn[i];
        const step = ++row.animationStep;
        const animHeight = getAnimationHeight(step, row.animationPower);
        const node = rowNode(row);
        const baseOpacity = (row.opacity === undefined ? 1 : row.opacity);
        if (step <= -OPACITY_STEPS) {
          node.find('td').height(animHeight);
        } else if (step === -OPACITY_STEPS + 1) {
          node.empty().append(createUserRowTds(animHeight, row.data))
              .find('td').css('opacity', baseOpacity * 1 / OPACITY_STEPS);
        } else if (step < 0) {
          node.find('td').css('opacity', baseOpacity * (OPACITY_STEPS - (-step)) / OPACITY_STEPS)
              .height(animHeight);
        } else if (step === 0) {
          // set HTML in case modified during animation
          node.empty().append(createUserRowTds(animHeight, row.data))
              .find('td').css('opacity', baseOpacity * 1).height(animHeight);
          rowsFadingIn.splice(i, 1); // remove from set
        }
      }
      for (let i = rowsFadingOut.length - 1; i >= 0; i--) { // backwards to allow removal
        const row = rowsFadingOut[i];
        const step = ++row.animationStep;
        const node = rowNode(row);
        const animHeight = getAnimationHeight(step, row.animationPower);
        const baseOpacity = (row.opacity === undefined ? 1 : row.opacity);
        if (step < OPACITY_STEPS) {
          node.find('td').css('opacity', baseOpacity * (OPACITY_STEPS - step) / OPACITY_STEPS)
              .height(animHeight);
        } else if (step === OPACITY_STEPS) {
          node.empty().append(createEmptyRowTds(animHeight));
        } else if (step <= ANIMATION_END) {
          node.find('td').height(animHeight);
        } else {
          rowsFadingOut.splice(i, 1); // remove from set
          node.remove();
        }
      }

      handleOtherUserInputs();

      return (rowsFadingIn.length > 0) || (rowsFadingOut.length > 0); // is more to do
    };

    const getAnimationHeight = (step, power) => {
      let a = Math.abs(step / 12);
      if (power === 2) a **= 2;
      else if (power === 3) a **= 3;
      else if (power === 4) a **= 4;
      else if (power >= 5) a **= 5;
      return Math.round(26 * (1 - a));
    };
    const OPACITY_STEPS = 6;

    const ANIMATION_STEP_TIME = 20;
    const LOWER_FRAMERATE_FACTOR = 2;
    const {scheduleAnimation} =
        padutils.makeAnimationScheduler(animateStep, ANIMATION_STEP_TIME, LOWER_FRAMERATE_FACTOR);

    const NUMCOLS = 4;

    // we do lots of manipulation of table rows and stuff that JQuery makes ok, despite
    // IE's poor handling when manipulating the DOM directly.

    const createEmptyRowTds = (height) => $('<td>')
        .attr('colspan', NUMCOLS)
        .css('border', 0)
        .css('height', `${height}px`);

    const isNameEditable = (data) => (!data.name) && (data.status !== 'Disconnected');

    const replaceUserRowContents = (tr, height, data) => {
      const tds = createUserRowTds(height, data);
      if (isNameEditable(data) && tr.find('td.usertdname input:enabled').length > 0) {
        // preserve input field node
        tds.each((i, td) => {
          const oldTd = $(tr.find('td').get(i));
          if (!oldTd.hasClass('usertdname')) {
            oldTd.replaceWith(td);
          } else {
            // Prevent leak. I'm not 100% confident that this is necessary, but it shouldn't hurt.
            $(td).remove();
          }
        });
      } else {
        tr.empty().append(tds);
      }
      return tr;
    };

    const createUserRowTds = (height, data) => {
      let name;
      if (data.name) {
        name = document.createTextNode(data.name);
      } else {
        name = $('<input>')
            .attr('data-l10n-id', 'pad.userlist.unnamed')
            .attr('type', 'text')
            .addClass('editempty')
            .addClass('newinput')
            .attr('value', html10n.get('pad.userlist.unnamed'));
        if (isNameEditable(data)) name.attr('disabled', 'disabled');
      }
      return $()
          .add($('<td>')
              .css('height', `${height}px`)
              .addClass('usertdswatch')
              .append($('<div>')
                  .addClass('swatch')
                  .css('background', padutils.escapeHtml(data.color))
                  .html('&nbsp;')))
          .add($('<td>')
              .css('height', `${height}px`)
              .addClass('usertdname')
              .append(name))
          .add($('<td>')
              .css('height', `${height}px`)
              .addClass('activity')
              .text(data.activity));
    };

    const createRow = (id, contents, authorId) => $('<tr>')
        .attr('data-authorId', authorId)
        .attr('id', id)
        .append(contents);

    const rowNode = (row) => $(`#${row.domId}`);

    const handleRowData = (row) => {
      if (row.data && row.data.status === 'Disconnected') {
        row.opacity = 0.5;
      } else {
        delete row.opacity;
      }
    };

    const handleOtherUserInputs = () => {
      // handle 'INPUT' elements for naming other unnamed users
      $('#otheruserstable input.newinput').each(function () {
        const input = $(this);
        const tr = input.closest('tr');
        if (tr.length > 0) {
          const index = tr.parent().children().index(tr);
          if (index >= 0 && rowsPresent.length > index) {
            const userId = rowsPresent[index].data.id;
            rowManagerMakeNameEditor($(this), userId);
          }
        }
      }).removeClass('newinput');
    };

    // animationPower is 0 to skip animation, 1 for linear, 2 for quadratic, etc.


    const insertRow = (position, data, animationPower) => {
      position = Math.max(0, Math.min(rowsPresent.length, position));
      animationPower = (animationPower === undefined ? 4 : animationPower);

      const domId = nextRowId();
      const row = {
        data,
        animationStep: ANIMATION_START,
        domId,
        animationPower,
      };
      const authorId = data.id;

      handleRowData(row);
      rowsPresent.splice(position, 0, row);
      let tr;
      if (animationPower === 0) {
        tr = createRow(domId, createUserRowTds(getAnimationHeight(0), data), authorId);
        row.animationStep = 0;
      } else {
        rowsFadingIn.push(row);
        tr = createRow(domId, createEmptyRowTds(getAnimationHeight(ANIMATION_START)), authorId);
      }
      $('table#otheruserstable').show();
      if (position === 0) {
        $('table#otheruserstable').prepend(tr);
      } else {
        rowNode(rowsPresent[position - 1]).after(tr);
      }

      if (animationPower !== 0) {
        scheduleAnimation();
      }

      handleOtherUserInputs();

      return row;
    };

    const updateRow = (position, data) => {
      const row = rowsPresent[position];
      if (row) {
        row.data = data;
        handleRowData(row);
        if (row.animationStep === 0) {
          // not currently animating
          const tr = rowNode(row);
          replaceUserRowContents(tr, getAnimationHeight(0), row.data)
              .find('td')
              .css('opacity', (row.opacity === undefined ? 1 : row.opacity));
          handleOtherUserInputs();
        }
      }
    };

    const removeRow = (position, animationPower) => {
      animationPower = (animationPower === undefined ? 4 : animationPower);
      const row = rowsPresent[position];
      if (row) {
        rowsPresent.splice(position, 1); // remove
        if (animationPower === 0) {
          rowNode(row).remove();
        } else {
          row.animationStep = -row.animationStep; // use symmetry
          row.animationPower = animationPower;
          rowsFadingOut.push(row);
          scheduleAnimation();
        }
      }
      if (rowsPresent.length === 0) {
        $('table#otheruserstable').hide();
      }
    };

    // newPosition is position after the row has been removed


    const moveRow = (oldPosition, newPosition, animationPower) => {
      animationPower = (animationPower === undefined ? 1 : animationPower); // linear is best
      const row = rowsPresent[oldPosition];
      if (row && oldPosition !== newPosition) {
        const rowData = row.data;
        removeRow(oldPosition, animationPower);
        insertRow(newPosition, rowData, animationPower);
      }
    };

    const self = {
      insertRow,
      removeRow,
      moveRow,
      updateRow,
    };
    return self;
  })(); // //////// rowManager
  const otherUsersInfo = [];
  const otherUsersData = [];

  const rowManagerMakeNameEditor = (jnode, userId) => {
    setUpEditable(jnode, () => {
      const existingIndex = findExistingIndex(userId);
      if (existingIndex >= 0) {
        return otherUsersInfo[existingIndex].name || '';
      } else {
        return '';
      }
    }, (newName) => {
      if (!newName) {
        jnode.addClass('editempty');
        jnode.val(html10n.get('pad.userlist.unnamed'));
      } else {
        jnode.attr('disabled', 'disabled');
        pad.suggestUserName(userId, newName);
      }
    });
  };

  const findExistingIndex = (userId) => {
    let existingIndex = -1;
    for (let i = 0; i < otherUsersInfo.length; i++) {
      if (otherUsersInfo[i].userId === userId) {
        existingIndex = i;
        break;
      }
    }
    return existingIndex;
  };

  const setUpEditable = (jqueryNode, valueGetter, valueSetter) => {
    jqueryNode.on('focus', (evt) => {
      const oldValue = valueGetter();
      if (jqueryNode.val() !== oldValue) {
        jqueryNode.val(oldValue);
      }
      jqueryNode.addClass('editactive').removeClass('editempty');
    });
    jqueryNode.on('blur', (evt) => {
      const newValue = jqueryNode.removeClass('editactive').val();
      valueSetter(newValue);
    });
    padutils.bindEnterAndEscape(jqueryNode, () => {
      jqueryNode.trigger('blur');
    }, () => {
      jqueryNode.val(valueGetter()).trigger('blur');
    });
    jqueryNode.prop('disabled', false).addClass('editable');
  };

  let pad = undefined;
  const self = {
    init: (myInitialUserInfo, _pad) => {
      pad = _pad;

      self.setMyUserInfo(myInitialUserInfo);

      if ($('#online_count').length === 0) {
        $('#editbar [data-key=showusers] > a').append('<span id="online_count">1</span>');
      }

      $('#otheruserstable tr').remove();

      $('#myusernameedit').addClass('myusernameedithoverable');
      setUpEditable($('#myusernameedit'), () => myUserInfo.name || '', (newValue) => {
        myUserInfo.name = newValue;
        pad.notifyChangeName(newValue);
        // wrap with setTimeout to do later because we get
        // a double "blur" fire in IE...
        window.setTimeout(() => {
          self.renderMyUserInfo();
        }, 0);
      });

      // color picker
      $('#myswatchbox').on('click', showColorPicker);
      $('#mycolorpicker .pickerswatchouter').on('click', function () {
        $('#mycolorpicker .pickerswatchouter').removeClass('picked');
        $(this).addClass('picked');
      });
      $('#mycolorpickersave').on('click', () => {
        closeColorPicker(true);
      });
      $('#mycolorpickercancel').on('click', () => {
        closeColorPicker(false);
      });
      //
    },
    usersOnline: () => {
      // Returns an object of users who are currently online on this pad
      // Make a copy of the otherUsersInfo, otherwise every call to users
      // modifies the referenced array
      const userList = [].concat(otherUsersInfo);
      // Now we need to add ourselves..
      userList.push(myUserInfo);
      return userList;
    },
    users: () => {
      // Returns an object of users who have been on this pad
      const userList = self.usersOnline();

      // Now we add historical authors
      const historical = clientVars.collab_client_vars.historicalAuthorData;
      for (const [key, {userId}] of Object.entries(historical)) {
        // Check we don't already have this author in our array
        let exists = false;

        userList.forEach((user) => {
          if (user.userId === userId) exists = true;
        });

        if (exists === false) {
          userList.push(historical[key]);
        }
      }
      return userList;
    },
    setMyUserInfo: (info) => {
      // translate the colorId
      if (typeof info.colorId === 'number') {
        info.colorId = clientVars.colorPalette[info.colorId];
      }

      myUserInfo = $.extend(
          {}, info);

      self.renderMyUserInfo();
    },
    userJoinOrUpdate: (info) => {
      if ((!info.userId) || (info.userId === myUserInfo.userId)) {
        // not sure how this would happen
        return;
      }

      hooks.callAll('userJoinOrUpdate', {
        userInfo: info,
      });

      const userData = {};
      userData.color = typeof info.colorId === 'number'
        ? clientVars.colorPalette[info.colorId] : info.colorId;
      userData.name = info.name;
      userData.status = '';
      userData.activity = '';
      userData.id = info.userId;

      const existingIndex = findExistingIndex(info.userId);

      let numUsersBesides = otherUsersInfo.length;
      if (existingIndex >= 0) {
        numUsersBesides--;
      }
      const newIndex = padutils.binarySearch(numUsersBesides, (n) => {
        if (existingIndex >= 0 && n >= existingIndex) {
          // pretend existingIndex isn't there
          n++;
        }
        const infoN = otherUsersInfo[n];
        const nameN = (infoN.name || '').toLowerCase();
        const nameThis = (info.name || '').toLowerCase();
        const idN = infoN.userId;
        const idThis = info.userId;
        return (nameN > nameThis) || (nameN === nameThis && idN > idThis);
      });

      if (existingIndex >= 0) {
        // update
        if (existingIndex === newIndex) {
          otherUsersInfo[existingIndex] = info;
          otherUsersData[existingIndex] = userData;
          rowManager.updateRow(existingIndex, userData);
        } else {
          otherUsersInfo.splice(existingIndex, 1);
          otherUsersData.splice(existingIndex, 1);
          otherUsersInfo.splice(newIndex, 0, info);
          otherUsersData.splice(newIndex, 0, userData);
          rowManager.updateRow(existingIndex, userData);
          rowManager.moveRow(existingIndex, newIndex);
        }
      } else {
        otherUsersInfo.splice(newIndex, 0, info);
        otherUsersData.splice(newIndex, 0, userData);
        rowManager.insertRow(newIndex, userData);
      }

      self.updateNumberOfOnlineUsers();
    },
    updateNumberOfOnlineUsers: () => {
      let online = 1; // you are always online!
      for (let i = 0; i < otherUsersData.length; i++) {
        if (otherUsersData[i].status === '') {
          online++;
        }
      }

      if (localStorage.getItem('recentPads') != null) {
        const recentPadsList = JSON.parse(localStorage.getItem('recentPads'));
        const pathSegments = window.location.pathname.split('/');
        const padName = pathSegments[pathSegments.length - 1];
        const existingPad = recentPadsList.find((pad) => pad.name === padName);
        if (existingPad) {
          existingPad.members = online;
        }
        localStorage.setItem('recentPads', JSON.stringify(recentPadsList));
      }

      $('#online_count').text(online);

      return online;
    },
    userLeave: (info) => {
      const existingIndex = findExistingIndex(info.userId);
      if (existingIndex >= 0) {
        const userData = otherUsersData[existingIndex];
        userData.status = 'Disconnected';
        rowManager.updateRow(existingIndex, userData);
        if (userData.leaveTimer) {
          window.clearTimeout(userData.leaveTimer);
        }
        // set up a timer that will only fire if no leaves,
        // joins, or updates happen for this user in the
        // next N seconds, to remove the user from the list.
        const thisUserId = info.userId;
        const thisLeaveTimer = window.setTimeout(() => {
          const newExistingIndex = findExistingIndex(thisUserId);
          if (newExistingIndex >= 0) {
            const newUserData = otherUsersData[newExistingIndex];
            if (newUserData.status === 'Disconnected' &&
                newUserData.leaveTimer === thisLeaveTimer) {
              otherUsersInfo.splice(newExistingIndex, 1);
              otherUsersData.splice(newExistingIndex, 1);
              rowManager.removeRow(newExistingIndex);
              hooks.callAll('userLeave', {
                userInfo: info,
              });
            }
          }
        }, 8000); // how long to wait
        userData.leaveTimer = thisLeaveTimer;
      }

      self.updateNumberOfOnlineUsers();
    },
    renderMyUserInfo: () => {
      if (myUserInfo.name) {
        $('#myusernameedit').removeClass('editempty').val(myUserInfo.name);
      } else {
        $('#myusernameedit').attr('placeholder', html10n.get('pad.userlist.entername'));
      }
      if (colorPickerOpen) {
        $('#myswatchbox').addClass('myswatchboxunhoverable').removeClass('myswatchboxhoverable');
      } else {
        $('#myswatchbox').addClass('myswatchboxhoverable').removeClass('myswatchboxunhoverable');
      }

      $('#myswatch').css({'background-color': myUserInfo.colorId});
      $('li[data-key=showusers] > a').css({'box-shadow': `inset 0 0 30px ${myUserInfo.colorId}`});
    },
  };
  return self;
})();

const getColorPickerSwatchIndex = (jnode) => $('#colorpickerswatches li').index(jnode);

const closeColorPicker = (accept) => {
  if (accept) {
    let newColor = $('#mycolorpickerpreview').css('background-color');
    const parts = newColor.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
    // parts now should be ["rgb(0, 70, 255", "0", "70", "255"]
    if (parts) {
      delete (parts[0]);
      for (let i = 1; i <= 3; ++i) {
        parts[i] = parseInt(parts[i]).toString(16);
        if (parts[i].length === 1) parts[i] = `0${parts[i]}`;
      }
      newColor = `#${parts.join('')}`; // "0070ff"
    }
    myUserInfo.colorId = newColor;
    pad.notifyChangeColor(newColor);
    paduserlist.renderMyUserInfo();
  } else {
    // pad.notifyChangeColor(previousColorId);
    // paduserlist.renderMyUserInfo();
  }

  colorPickerOpen = false;
  $('#mycolorpicker').removeClass('popup-show');
};

const showColorPicker = () => {
  $.farbtastic('#colorpicker').setColor(myUserInfo.colorId);

  if (!colorPickerOpen) {
    const palette = pad.getColorPalette();

    if (!colorPickerSetup) {
      const colorsList = $('#colorpickerswatches');
      for (let i = 0; i < palette.length; i++) {
        const li = $('<li>', {
          style: `background: ${palette[i]};`,
        });

        li.appendTo(colorsList);

        li.on('click', (event) => {
          $('#colorpickerswatches li').removeClass('picked');
          $(event.target).addClass('picked');

          const newColorId = getColorPickerSwatchIndex($('#colorpickerswatches .picked'));
          pad.notifyChangeColor(newColorId);
        });
      }

      colorPickerSetup = true;
    }

    $('#mycolorpicker').addClass('popup-show');
    colorPickerOpen = true;

    $('#colorpickerswatches li').removeClass('picked');
    $($('#colorpickerswatches li')[myUserInfo.colorId]).addClass('picked'); // seems weird
  }
};

exports.paduserlist = paduserlist;
