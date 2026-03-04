import html10n from '../js/vendors/html10n';


// Set language for l10n
let regexpLang: string | undefined;
let language = document.cookie.match(/language=((\w{2,3})(-\w+)?)/);
if (language) regexpLang = language[1];

html10n.mt.bind('indexed', () => {
  html10n.localize([regexpLang, navigator.language, 'en']);
});

html10n.mt.bind('localized', () => {
  document.documentElement.lang = html10n.getLanguage()!;
  document.documentElement.dir = html10n.getDirection()!;
});
