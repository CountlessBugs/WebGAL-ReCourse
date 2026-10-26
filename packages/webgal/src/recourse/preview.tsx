// SPDX-License-Identifier: MPL-2.0
import { useEffect } from 'react';
import ReactDOM from 'react-dom';
import { Provider } from 'react-redux';
import i18n from 'i18next';
import { injectGlobal } from '@emotion/css';
import { WebGAL } from '@/Core/WebGAL';
import { scss2cssinjsParser } from '@/Core/controller/customUI/scss2cssinjsParser';
import { webgalStore } from '@/store/store';
import { TextPreview } from '@/UI/Menu/Options/TextPreview/TextPreview';

export function startSettingsPreview(): void {
  const origin = window.recoursePreviewOrigin!;
  const notify = (type: string) => parent.postMessage({ type }, origin);
  const style = scss2cssinjsParser(window.recourseTextboxStyle ?? '');
  WebGAL.styleObjects.set('textbox', style);
  injectGlobal(style.others);
  let revision = 0;
  function Mounted() {
    useEffect(() => {
      notify('recourse:preview-ready');
    }, []);
    return <TextPreview text="让知识，成为我们的故事。调整设置，找到适合自己的阅读节奏。" title="阅读预览" />;
  }
  function render() {
    ReactDOM.render(
      <Provider store={webgalStore}>
        <Mounted key={revision} />
      </Provider>,
      document.querySelector('#root'),
    );
  }
  const limits: Record<string, number> = { textSpeed: 100, textSize: 2, textboxFont: 3, textboxOpacity: 100 };
  window.addEventListener('message', (event) => {
    if (event.source !== parent || event.origin !== origin) return;
    const message = event.data;
    if (!message || typeof message !== 'object') return;
    if (message.type === 'recourse:preview-settings') {
      const options = message.options;
      if (
        !options ||
        typeof options !== 'object' ||
        Array.isArray(options) ||
        Object.keys(options).length !== 4 ||
        Object.entries(limits).some(
          ([key, max]) => !Number.isInteger(options[key]) || options[key] < 0 || options[key] > max,
        )
      )
        return;
      for (const [key, value] of Object.entries(options))
        webgalStore.dispatch({ type: 'userData/setOptionData', payload: { key, value } });
    } else if (message.type !== 'recourse:preview-replay') return;
    revision += 1;
    render();
  });
  const resize = () => {
    document.querySelector<HTMLElement>('#root')!.style.transform = `scale(${innerWidth / 2560})`;
  };
  window.addEventListener('resize', resize);
  resize();
  i18n.changeLanguage('zhCn').then(render);
}
