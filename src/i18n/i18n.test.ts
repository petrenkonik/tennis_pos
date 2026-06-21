import { describe, it, expect } from 'vitest';
import i18n from './index';
import en from './locales/en.json';
import ru from './locales/ru.json';

// Walk a nested object and collect every leaf path in dot notation
// (e.g. "rules.C3.advice"), so we can diff the two catalogs structurally.
function leafPaths(obj: unknown, prefix = ''): string[] {
  if (obj !== null && typeof obj === 'object' && !Array.isArray(obj)) {
    return Object.entries(obj as Record<string, unknown>).flatMap(
      ([k, v]) => leafPaths(v, prefix ? `${prefix}.${k}` : k),
    );
  }
  return [prefix];
}

describe('i18n catalogs', () => {
  it('en and ru expose the same set of keys', () => {
    const enKeys = leafPaths(en).sort();
    const ruKeys = leafPaths(ru).sort();
    expect(ruKeys).toEqual(enKeys);
  });

  it('has loaded both locales into the i18n instance', () => {
    expect(Object.keys(i18n.options.resources ?? {})).toEqual(
      expect.arrayContaining(['en', 'ru']),
    );
  });

  it('translates a sample key in both languages', () => {
    expect(i18n.getFixedT('en')('app.title')).toBe('Serve Analysis');
    expect(i18n.getFixedT('ru')('app.title')).toBe('Анализ подачи');
  });
});
