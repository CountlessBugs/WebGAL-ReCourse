import { FontOption } from '@/store/guiInterface';
import { TemplateFontDescriptor } from '@/types/template';
import { courseFontFamilies, systemFont } from '@/recourse/fonts';

export const DEFAULT_FONT_OPTIONS: FontOption[] = [
  { family: systemFont, source: 'default', label: '系统默认' },
  {
    family: courseFontFamilies[0],
    source: 'default',
    labelKey: 'textFont.options.resourceHanRounded',
  },
  {
    family: courseFontFamilies[1],
    source: 'default',
    labelKey: 'textFont.options.siYuanSimSun',
  },
  {
    family: courseFontFamilies[2],
    source: 'default',
    labelKey: 'textFont.options.SimHei',
  },
];

export const FALLBACK_FONT_FAMILY = systemFont;

export function buildFontOptionsFromTemplate(fonts: TemplateFontDescriptor[]): FontOption[] {
  const templateOptions: FontOption[] = fonts.map((font) => ({
    family: formatFontFamily(font['font-family']),
    source: 'template',
    label: font['font-family'],
  }));

  const combined = [DEFAULT_FONT_OPTIONS[0], ...templateOptions, ...DEFAULT_FONT_OPTIONS.slice(1)];

  const seen = new Set<string>();
  return combined.filter((option) => {
    if (seen.has(option.family)) return false;
    seen.add(option.family);
    return true;
  });
}

export function formatFontFamily(fontFamily: string): string {
  const trimmed = fontFamily.trim();
  const needsQuote = /\s/.test(trimmed);
  const normalized = needsQuote ? `'${trimmed}'` : trimmed;
  return `${normalized}, serif`;
}
