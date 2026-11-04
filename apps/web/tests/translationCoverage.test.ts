import { describe, expect, test } from 'vitest';
import { messages } from '../src/i18n/messages';

// The catalogues are typed so a *missing* key is a compile error, but nothing
// catches a key whose Chinese value was copied from English and never translated.
// Chinese is the default locale, so such a string shows English to most users.
const CJK = /[\u3400-\u9fff\uf900-\ufaff]/;
const LATIN_WORD = /[A-Za-z]{3,}/;

type Catalog = Record<string, unknown>;

function flatten(catalog: Catalog, prefix = '', into: Map<string, string> = new Map()): Map<string, string> {
  for (const [key, value] of Object.entries(catalog)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object') flatten(value as Catalog, path, into);
    else if (typeof value === 'string') into.set(path, value);
  }
  return into;
}

const english = flatten(messages.en as unknown as Catalog);
const chinese = flatten(messages['zh-CN'] as unknown as Catalog);

describe('translation coverage', () => {
  test('defines every English key in Chinese', () => {
    const missing = [...english.keys()].filter((key) => !chinese.has(key));
    expect(missing, `untranslated keys: ${missing.join(', ')}`).toEqual([]);
    const extra = [...chinese.keys()].filter((key) => !english.has(key));
    expect(extra, `keys with no English counterpart: ${extra.join(', ')}`).toEqual([]);
  });

  test('translates every Chinese label that contains words', () => {
    // A string may legitimately match English when it is an identifier rather than
    // prose: a product name, a protocol name, a stream name, a URL or path, or a
    // file name shown as a hint. Everything else with letters in both catalogues is
    // a label somebody forgot to translate, which the default Chinese UI would then
    // show in English.
    const IDENTIFIERS = new Set([
      'brand.name',                            // the product is called Sandkasten in every locale
      'setup.mode.webui',                      // the install mode is named WebUI
      'apiEndpoint.placeholder',               // a literal example URL
      'inspector.stdout',                      // stream names stay as the tool prints them
      'inspector.stderr',
      'ide.explorer.folderNamePlaceholder',    // a sample directory name
      'ide.explorer.fileNamePlaceholder',      // a sample file name
      'ide.remote.directoryPlaceholder',       // an example absolute path
    ]);
    const untranslated: string[] = [];
    for (const [key, englishValue] of english) {
      const chineseValue = chinese.get(key);
      if (chineseValue === undefined) continue;
      if (chineseValue !== englishValue) continue;
      if (!LATIN_WORD.test(englishValue)) continue;
      if (IDENTIFIERS.has(key)) continue;
      untranslated.push(`${key} = ${JSON.stringify(englishValue)}`);
    }
    expect(untranslated, `Chinese values copied from English: ${untranslated.join(', ')}`).toEqual([]);
  });

  test('writes Chinese prose with Chinese characters', () => {
    // Longer strings are sentences rather than labels; a sentence with no CJK at
    // all is almost certainly untranslated even if it was lightly edited.
    const prose: string[] = [];
    for (const [key, chineseValue] of chinese) {
      if (chineseValue.length < 24) continue;
      if (!LATIN_WORD.test(chineseValue)) continue;
      if (CJK.test(chineseValue)) continue;
      prose.push(`${key} = ${JSON.stringify(chineseValue)}`);
    }
    expect(prose, `Chinese sentences with no CJK: ${prose.join(', ')}`).toEqual([]);
  });

  test('keeps the two catalogues the same size', () => {
    // Guards the flattening helpers: if either walk silently returned nothing, the
    // assertions above would pass without inspecting anything.
    expect(english.size).toBeGreaterThan(300);
    expect(chinese.size).toBe(english.size);
  });
});
