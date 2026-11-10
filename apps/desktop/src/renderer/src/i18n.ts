import { BRAND } from '@lonca/protocol';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import tr from './locales/tr.json';

void i18n.use(initReactI18next).init({
  resources: { tr: { translation: tr }, en: { translation: en } },
  lng: navigator.language.toLowerCase().startsWith('tr') ? 'tr' : 'en',
  fallbackLng: 'en',
  // `{{app}}` in the locale files is the product's name.
  interpolation: { escapeValue: false, defaultVariables: { app: BRAND.name } },
  returnNull: false,
});

export default i18n;
