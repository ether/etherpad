// @ts-nocheck
'use strict';

const containers = ['editor', 'background', 'toolbar'];
const colors = ['super-light', 'light', 'dark', 'super-dark'];

// Mirrors src/node/utils/SkinColors.ts: toolbar variants in CSS source order
// from src/static/skins/colibris/src/pad-variants.css. The last matching token
// wins, so iterate in source order.
const TOOLBAR_COLORS_IN_CSS_ORDER: Array<[string, string]> = [
  ['super-light-toolbar', '#ffffff'],
  ['light-toolbar', '#f2f3f4'],
  ['super-dark-toolbar', '#485365'],
  ['dark-toolbar', '#576273'],
];

// Keep <meta name="theme-color"> in sync with the toolbar the user actually
// sees. The server emits a baseline derived from settings.skinVariants, but
// pad.ts may flip the toolbar to super-dark on first paint (enableDarkMode
// + prefers-color-scheme:dark + no localStorage white-mode override) and
// the user can toggle via #options-darkmode. Without this, dark-mode users
// keep the light meta and see a white address bar above a dark toolbar
// (issue #7606 follow-up).
const updateThemeColorMeta = (newClasses: string[]) => {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) return;
  const tokens = new Set(newClasses.join(' ').split(/\s+/).filter(Boolean));
  let color = '#ffffff';
  for (const [variant, c] of TOOLBAR_COLORS_IN_CSS_ORDER) {
    if (tokens.has(variant)) color = c;
  }
  meta.setAttribute('content', color);
};

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
