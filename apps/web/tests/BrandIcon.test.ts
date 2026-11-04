import { mount } from '@vue/test-utils';
import { describe, expect, test } from 'vitest';
import AppHeader from '../src/components/AppHeader.vue';
import { createTranslator } from '../src/i18n/locale';

describe('brand identity', () => {
  test('the header carries no logo mark beside the navigation arrows', () => {
    // The product mark moved out of the title row by request; the row now starts
    // with the history arrows, so nothing image-like may lead it.
    const wrapper = mount(AppHeader, { props: { connectionState: 'connected', t: createTranslator('en') } });
    expect(wrapper.find('.brand').exists()).toBe(false);
    expect(wrapper.find('img').exists()).toBe(false);
    // The product name still identifies the window through the title control.
    expect(wrapper.get('[data-testid="window-title"]').text().length).toBeGreaterThan(0);
  });
});
