import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, test } from 'vitest';
import App from '../src/App.vue';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SETUP_WELCOME_STORAGE_KEY } from '../src/composables/useSetupWelcome';

afterEach(() => window.localStorage.clear());

describe('Vue foundation', () => {
  test('mounts the application shell into a real Vue component', () => {
    window.localStorage.setItem(SETUP_WELCOME_STORAGE_KEY, 'true');
    const wrapper = mount(App);
    expect(wrapper.find('[data-testid="app-shell"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('Sandkasten');
  });

  test('loads config before the Vue module and mounts App at the root', () => {
    const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
    const main = readFileSync(resolve(process.cwd(), 'src/main.ts'), 'utf8');
    expect(html.indexOf('src="./config.js"')).toBeLessThan(html.indexOf('src="./src/main.ts"'));
    expect(main).toContain("createApp(App).mount('#app')");
  });
});
