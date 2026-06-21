import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import en from './locales/en.json';
import ru from './locales/ru.json';

// Supported locales. Anything navigator.language that starts with "ru" maps to
// "ru" by i18next's fallback rules; everything else falls back to "en".
export const SUPPORTED_LANGS = ['en', 'ru'] as const;
export type SupportedLang = (typeof SUPPORTED_LANGS)[number];

// localStorage key under which the manual override (the EN/РУ toggle) is cached.
// LanguageDetector reads/writes it; when absent, it falls back to navigator.
export const LANG_STORAGE_KEY = 'tennis_pos_lang';

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      ru: { translation: ru },
    },
    fallbackLng: 'en',
    supportedLngs: [...SUPPORTED_LANGS],
    interpolation: { escapeValue: false }, // React escapes by itself
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: LANG_STORAGE_KEY,
      caches: ['localStorage'],
    },
  });

// Keep <html lang="…"> in sync so browser a11y features and search engines see
// the active language. Set immediately on init, then on every change.
const setHtmlLang = (lng: string): void => {
  document.documentElement.lang = lng;
};
setHtmlLang(i18n.language?.split('-')[0] ?? 'en');
i18n.on('languageChanged', setHtmlLang);

export default i18n;
