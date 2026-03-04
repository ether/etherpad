// @ts-nocheck
'use strict';

const containers = ['editor', 'background', 'toolbar'];
const colors = ['super-light', 'light', 'dark', 'super-dark'];

// add corresponding classes when config change
const updateSkinVariantsClasses = (newClasses) => {
  const domsToUpdate = [
    $('html'),
    $('iframe[name=ace_outer]').contents().find('html'),
    $('iframe[name=ace_outer]').contents().find('iframe[name=ace_inner]').contents().find('html'),
  ];

  colors.forEach((color) => {
    containers.forEach((container) => {
      domsToUpdate.forEach((el) => { el.removeClass(`${color}-${container}`); });
    });
  });

  domsToUpdate.forEach((el) => { el.removeClass('full-width-editor'); });

  domsToUpdate.forEach((el) => { el.addClass(newClasses.join(' ')); });
};


const isDarkMode = ()=>{
  return $('html').hasClass('super-dark-editor')
}


const setDarkModeInLocalStorage = (isDark)=>{
  localStorage.setItem('ep_darkMode', isDark?'true':'false');
}

const isDarkModeEnabledInLocalStorage = ()=>{
  return localStorage.getItem('ep_darkMode')==='true';
}

const isWhiteModeEnabledInLocalStorage = ()=>{
  return localStorage.getItem('ep_darkMode')==='false';
}

// Specific hash to display the skin variants builder popup
if (window.location.hash.toLowerCase() === '#skinvariantsbuilder') {
  $('#skin-variants').addClass('popup-show');

  const getNewClasses = () => {
    const newClasses = [];
    $('select.skin-variant-color').each(function () {
      newClasses.push(`${$(this).val()}-${$(this).data('container')}`);
    });
    if ($('#skin-variant-full-width').is(':checked')) newClasses.push('full-width-editor');

    $('#skin-variants-result').val(`"skinVariants": "${newClasses.join(' ')}",`);

    return newClasses;
  }

  // run on init
  const updateCheckboxFromSkinClasses = () => {
    $('html').attr('class').split(' ').forEach((classItem) => {
      const container = classItem.substring(classItem.lastIndexOf('-') + 1, classItem.length);
      if (containers.indexOf(container) > -1) {
        const color = classItem.substring(0, classItem.lastIndexOf('-'));
        $(`.skin-variant-color[data-container="${container}"`).val(color);
      }
    });

    $('#skin-variant-full-width').prop('checked', $('html').hasClass('full-width-editor'));
  };

  $('.skin-variant').on('change', () => {
    updateSkinVariantsClasses(getNewClasses());
  });

  updateCheckboxFromSkinClasses();
  updateSkinVariantsClasses(getNewClasses());
}

exports.isDarkMode = isDarkMode;
exports.setDarkModeInLocalStorage = setDarkModeInLocalStorage
exports.isWhiteModeEnabledInLocalStorage = isWhiteModeEnabledInLocalStorage
exports.isDarkModeEnabledInLocalStorage = isDarkModeEnabledInLocalStorage
exports.updateSkinVariantsClasses = updateSkinVariantsClasses;
