// SPDX-License-Identifier: MPL-2.0
import rounded from '@/assets/fonts/ResourceHanRoundedCN-Regular.ttf?url';
import serif from '@/assets/fonts/SourceHanSerifCN-Regular.ttf?url';
import sans from '@/assets/fonts/OPPOSans-R.ttf?url';

export const systemFont = 'system-ui, "Microsoft YaHei", "PingFang SC", sans-serif';
export const courseFontFamilies = [0, 1, 2].map((index) => `"recourse-font-${index}", ${systemFont}`);
const urls = [rounded, serif, sans];
const pending = new Set<number>();

export function restoreCourseFont(options: Record<string, unknown>) {
  return {
    ...options,
    textboxFont:
      options.recourseFontVersion === 1 && Number.isInteger(options.textboxFont) && Number(options.textboxFont) >= 0
        ? Number(options.textboxFont)
        : 0,
    recourseFontVersion: 1,
  };
}

export function requestCourseFont(family: string): string {
  const index = courseFontFamilies.indexOf(family);
  if (index >= 0 && !pending.has(index)) {
    pending.add(index);
    const face = new FontFace(`recourse-font-${index}`, `url("${urls[index]}")`, { display: 'swap' });
    face
      .load()
      .then((loaded) => document.fonts.add(loaded))
      .catch((error) => {
        console.warn('所选字体下载失败，继续使用系统字体：', error);
        if (window.recoursePreviewOrigin)
          parent.postMessage({ type: 'recourse:preview-error' }, window.recoursePreviewOrigin);
      });
  }
  return family;
}
