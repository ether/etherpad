import i18n from 'i18next'
import {initReactI18next} from "react-i18next";
import LanguageDetector from 'i18next-browser-languagedetector'
import type {BackendModule} from 'i18next';

// Core translations live in /src/locales (shared with the pad UI). Letting
// Vite resolve them via import.meta.glob means each language ships as its own
// hashed JSON chunk, lazy-loaded on demand — no build-time copy step or
// /admin/locales/* express route. Earlier setups copying files into the build
// output were fragile (see https://github.com/ether/etherpad/issues/7586).
const coreLocales = import.meta.glob<{default: Record<string, unknown>}>(
    '../../../src/locales/*.json');

const coreLocaleByLang = (language: string) =>
    coreLocales[`../../../src/locales/${language}.json`];

const LazyImportPlugin: BackendModule = {
  type: 'backend',
  init: function () {
  },
  read: async function (language, namespace, callback) {
    try {
      if (namespace === 'translation') {
        const loader = coreLocaleByLang(language);
        if (!loader) {
          callback(new Error(`No core locale for "${language}"`), null);
          return;
        }
        const mod = await loader();
        callback(null, mod.default);
        return;
      }
      // Plugin namespaces (e.g. ep_admin_pads) are still served as static
      // assets from admin/public/<namespace>/<lang>.json.
      const baseURL = `${import.meta.env.BASE_URL}/${namespace}/${language}.json`;
      const res = await fetch(baseURL);
      if (!res.ok) {
        callback(new Error(`HTTP ${res.status} loading ${baseURL}`), null);
        return;
      }
      callback(null, await res.json());
    } catch (e) {
      callback(e instanceof Error ? e : new Error(String(e)), null);
    }
  },

  save: function () {
  },

  create: function () {
    /* save the missing translation */
  },
};

i18n
  .use(LanguageDetector)
  .use(LazyImportPlugin)
  .use(initReactI18next)
  .init(
    {
      ns: ['translation','ep_admin_pads','ep_admin_authors'],
      fallbackLng: 'en'
    }
  )

export default i18n
