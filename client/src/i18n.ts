import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

// 导入翻译文件
import en from './locales/en/translation.json';
import zh from './locales/zh/translation.json';

i18n
  .use(LanguageDetector) // 自动检测用户语言
  .use(initReactI18next) // 将 i18n 实例传给 react-i18next
  .init({
    fallbackLng: 'en', // 如果检测不到语言，默认使用英文
    debug: true, // 开发模式下开启 debug
    interpolation: {
      escapeValue: false, // react 已经防止了 XSS
    },
    resources: {
      en: {
        translation: en,
      },
      zh: {
        translation: zh,
      },
    },
  });

export default i18n;
