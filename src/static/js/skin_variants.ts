// @ts-nocheck
'use strict';

import {toolbarColorForTokens} from './skin_toolbar_colors';

const containers = ['editor', 'background', 'toolbar'];
const colors = ['super-light', 'light', 'dark', 'super-dark'];

// Keep <meta name="theme-color"> in sync with the toolbar the user actually
// sees. The server emits a media-scoped light + dark pair so iOS Safari picks
// the right color at first paint (issue #7606); on desktop/Android the user
// can still override the system scheme via #options-darkmode. When that
// happens we point EVERY theme-color meta at the chosen color so the explicit
// choice wins regardless of which media query the browser is currently
// matching — otherwise toggling light while the OS is dark (or vice versa)
// would update a tag the browser is ignoring. Color resolution lives in
// skin_toolbar_colors so the server-rendered baseline and the client updates
// share one source of truth — Qodo flagged the prior duplicated table as a
// drift hazard.
const updateThemeColorMeta = (newClasses: string[]) => {
  const metas = document.querySelectorAll('meta[name="theme-color"]');
  if (!metas.length) return;
  const color = toolbarColorForTokens(newClasses.join(' ').split(/\s+/).filter(Boolean));
  metas.forEach((meta) => { meta.setAttribute('content', color); });
};

// add corresponding classes when config change
const updateSkinVariantsClasses = (newClasses) => {
  const domsToUpdate = [
    $('html'),
    $('iframe[name=ace_outer]').contents().find('html'),
    $('iframe[name=ace_outer]').contents().find('iframe[name=ace_inner]').contents().find('html'),
  ];

  // Issue #7659: when in-place history mode is active, the historical pad
  // renders inside #history-frame (its own document, with its own
  // ace_outer/ace_inner). Propagate skin tokens through the same path so a
  // user toggling dark mode while scrubbing sees the iframe re-theme.
  const $hist = $('#history-frame');
  if ($hist.length) {
    domsToUpdate.push($hist.contents().find('html'));
    domsToUpdate.push($hist.contents().find('iframe[name=ace_outer]').contents().find('html'));
    domsToUpdate.push(
        $hist.contents().find('iframe[name=ace_outer]').contents()
            .find('iframe[name=ace_inner]').contents().find('html'));
  }

  colors.forEach((color) => {
    containers.forEach((container) => {
      domsToUpdate.forEach((el) => { el.removeClass(`${color}-${container}`); });
    });
  });

  domsToUpdate.forEach((el) => { el.removeClass('full-width-editor'); });

  domsToUpdate.forEach((el) => { el.addClass(newClasses.join(' ')); });

  updateThemeColorMeta(newClasses);
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
