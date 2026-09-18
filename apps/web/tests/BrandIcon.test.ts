import { mount } from '@vue/test-utils';
import { describe, expect, test } from 'vitest';
import AppHeader from '../src/components/AppHeader.vue';
import { createTranslator } from '../src/i18n/locale';

describe('brand identity', () => {
  test('the header shows the app icon next to the product name', () => {
    const wrapper = mount(AppHeader, { props: { connectionState: 'connected', t: createTranslator('en') } });
    const brand = wrapper.get('.brand');
    const mark = brand.get('img');
    expect(mark.attributes('src')).toMatch(/^data:image\/png;base64,/);
    expect(mark.attributes('alt')).toBe('');
    expect(mark.attributes('aria-hidden')).toBe('true');
  });
});
