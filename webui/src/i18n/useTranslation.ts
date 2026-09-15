import { inject, type InjectionKey } from 'vue';
import { createTranslator, type Translator } from './locale';

export const TRANSLATOR_KEY: InjectionKey<Translator> = Symbol('sandkasten-translator');

const englishTranslator = createTranslator('en');

export function useTranslation(): Translator {
  return inject(TRANSLATOR_KEY, englishTranslator);
}
