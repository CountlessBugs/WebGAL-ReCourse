import { StrictMode } from 'react';
import ReactDOM from 'react-dom';
import App from './App';
import './index.scss';
import './assets/style/animation.scss';
import 'modern-css-reset/dist/reset.min.css';

/** i18n */
import i18n from 'i18next';
import { initReactI18next, Trans } from 'react-i18next';
import { defaultLanguage, i18nTranslationResources, language } from './config/language';
import { Provider } from 'react-redux';
import { webgalStore } from './store/store';
import { installCourseSettings } from './recourse/settings';
import { startSettingsPreview } from './recourse/preview';
import SceneParser from 'webgal-parser';
import { assetSetter } from './Core/util/gameAssetsAccess/assetSetter';
import { ADD_NEXT_ARG_LIST, SCRIPT_CONFIG } from './Core/parser/sceneParser';

export { WebGAL } from './Core/WebGAL';
export const recourseRuntime = { version: '4.6.6-recourse.3', upstream: '4.6.6', apiVersion: 1 };
export { configureGuidedReading, getReadingContext } from './recourse/reading/runtime';
export function parseCourseScene(text: string, url: string) {
  return new SceneParser(() => {}, assetSetter, ADD_NEXT_ARG_LIST, SCRIPT_CONFIG).parse(text, url, url);
}

i18n
  .use(initReactI18next) // passes i18n down to react-i18next
  .init({
    // the translations
    // (tip move them in a JSON file and import them,
    // or even better, manage them via a UI: https://react.i18next.com/guides/multiple-translation-files#manage-your-translations-with-a-management-gui)
    resources: i18nTranslationResources || {},
    lng: language[defaultLanguage] || 'zhCn', // if you're using a language detector, do not define the lng option
    fallbackLng: 'zhCn',

    interpolation: {
      escapeValue: false, // react already safes from xss => https://www.i18next.com/translation-function/interpolation#unescape
    },
  })
  .then(() => console.log('WebGAL i18n Ready!'));

// eslint-disable-next-line react/no-deprecated
if (window.recoursePreviewOrigin) {
  startSettingsPreview();
} else {
  installCourseSettings();
  ReactDOM.render(
    <StrictMode>
      <Trans>
        <Provider store={webgalStore}>
          <App />
        </Provider>
      </Trans>
    </StrictMode>,
    document.querySelector('#root'),
  );
}
