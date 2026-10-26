// SPDX-License-Identifier: MPL-2.0
import { webgalStore } from '@/store/store';
import { courseFontFamilies, systemFont } from './fonts';

export function installCourseSettings(): void {
  const raw = new URLSearchParams(location.hash.slice(1)).get('recourse-settings');
  if (!raw) return;
  const supplied: unknown = JSON.parse(raw);
  if (!supplied || typeof supplied !== 'object' || Array.isArray(supplied))
    throw new Error('阅读设置格式无效，请返回主界面重新打开章节。');
  const limits: Record<string, number> = {
    textSpeed: 100,
    autoSpeed: 100,
    textSize: 2,
    textboxFont: 3,
    textboxOpacity: 100,
    volumeMain: 100,
    bgmVolume: 100,
    vocalVolume: 100,
    seVolume: 100,
    uiSeVolume: 100,
    voiceInterruption: 1,
  };
  const options: Record<string, number | boolean> = {};
  for (const [key, value] of Object.entries(supplied)) {
    if (key === 'skipAll' && typeof value === 'boolean') options[key] = value;
    else if (Object.hasOwn(limits, key) && Number.isInteger(value) && value >= 0 && value <= limits[key])
      options[key] = value;
    else throw new Error('阅读设置包含无效选项，请返回主界面重新打开章节。');
  }
  let applying = false;
  function apply() {
    if (applying) return;
    applying = true;
    try {
      const state = webgalStore.getState();
      for (const [key, selected] of Object.entries(options)) {
        const family = selected === 0 ? systemFont : courseFontFamilies[Number(selected) - 1];
        const value =
          key === 'textboxFont' ? state.GUI.fontOptions.findIndex((font) => font.family === family) : selected;
        if (typeof value === 'number' && value < 0) continue;
        if ((state.userData.optionData as unknown as Record<string, unknown>)[key] !== value)
          webgalStore.dispatch({ type: 'userData/setOptionData', payload: { key, value } });
      }
    } finally {
      applying = false;
    }
  }
  webgalStore.subscribe(apply);
  apply();
}
