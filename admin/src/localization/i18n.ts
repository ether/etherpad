import i18n from 'i18next'
import {initReactI18next} from "react-i18next";
import LanguageDetector from 'i18next-browser-languagedetector'


import { BackendModule } from 'i18next';

const LazyImportPlugin: BackendModule = {
    type: 'backend',
    init: function () {
    },
    read: async function (language, namespace, callback) {

        let baseURL = import.meta.env.BASE_URL
        if(namespace === "translation") {
            // If default we load the translation file
            baseURL+=`/locales/${language}.json`
        } else {
            // Else we load the former plugin translation file
            baseURL+=`/${namespace}/${language}.json`
        }

        const localeJSON = await fetch(baseURL, {
            cache: "force-cache"
        })
        let json;

        try {
            json = JSON.parse(await localeJSON.text())
        } catch(e) {
             callback(new Error("Error loading"), null);
        }


        callback(null, json);
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
            ns: ['translation','ep_admin_pads'],
            fallbackLng: 'en'
        }
    )

export default i18n
