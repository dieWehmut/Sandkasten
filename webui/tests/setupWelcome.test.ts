import { mount } from '@vue/test-utils';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import InstallModeToggle from '../src/components/InstallModeToggle.vue';
import SetupWelcome from '../src/components/SetupWelcome.vue';
import { useSetupWelcome, type SetupWelcomeStorage } from '../src/composables/useSetupWelcome';
import { createTranslator } from '../src/i18n/locale';
import { buildInstallCommand } from '../src/setup/installGuide';

function createStorage(saved: string | null = null): SetupWelcomeStorage {
  return {
    getItem: vi.fn(() => saved),
    setItem: vi.fn(),
  };
}

describe('useSetupWelcome', () => {
  test('opens the guide for a browser that has not seen it', () => {
    const storage = createStorage();

    const setup = useSetupWelcome({ storage });

    expect(setup.seen.value).toBe(false);
    expect(setup.isGuideOpen.value).toBe(true);
    expect(storage.getItem).toHaveBeenCalledWith('sandkasten-install-guide-seen');
  });

  test('dismisses, persists the exact seen flag, and can reopen without clearing it', () => {
    const storage = createStorage();
    const setup = useSetupWelcome({ storage });

    setup.dismiss();

    expect(setup.seen.value).toBe(true);
    expect(setup.isGuideOpen.value).toBe(false);
    expect(storage.setItem).toHaveBeenCalledWith('sandkasten-install-guide-seen', 'true');

    setup.reopen();

    expect(setup.seen.value).toBe(true);
    expect(setup.isGuideOpen.value).toBe(true);
    expect(storage.setItem).toHaveBeenCalledTimes(1);
  });

  test('restores the exact seen value and keeps storage failures non-blocking', () => {
    const stored = useSetupWelcome({ storage: createStorage('true') });
    const blockedStorage: SetupWelcomeStorage = {
      getItem: vi.fn(() => { throw new Error('blocked'); }),
      setItem: vi.fn(() => { throw new Error('blocked'); }),
    };
    const blocked = useSetupWelcome({ storage: blockedStorage });

    expect(stored.seen.value).toBe(true);
    expect(stored.isGuideOpen.value).toBe(false);
    expect(blocked.isGuideOpen.value).toBe(true);

    expect(() => blocked.dismiss()).not.toThrow();
    expect(blocked.seen.value).toBe(true);
    expect(blocked.isGuideOpen.value).toBe(false);
  });
});

describe('InstallModeToggle', () => {
  test('renders localized radio choices and emits the selected mode', async () => {
    const t = createTranslator('en');
    const wrapper = mount(InstallModeToggle, { props: { modelValue: 'cli', t } });

    expect(wrapper.get('fieldset').attributes('data-testid')).toBe('install-mode-toggle');
    expect(wrapper.get('legend').text()).toBe(t('setup.mode'));
    expect((wrapper.get('[data-testid="install-mode-cli"]').element as HTMLInputElement).checked).toBe(true);
    expect(wrapper.text()).toContain(t('setup.mode.webui'));

    await wrapper.get('[data-testid="install-mode-webui"]').setValue(true);

    expect(wrapper.emitted('update:modelValue')).toEqual([['webui']]);
  });
});

describe('SetupWelcome', () => {
  test('renders the localized guide as semantic document-flow content', () => {
    const t = createTranslator('en');
    const wrapper = mount(SetupWelcome, { props: { t } });

    expect(wrapper.get('main[data-testid="setup-welcome"]')).toBeTruthy();
    expect(wrapper.get('section[data-testid="setup-guide"]')).toBeTruthy();
    expect(wrapper.get('[data-testid="setup-title"]').text()).toBe(t('setup.title'));
    expect(wrapper.get('[data-testid="browser-install-warning"]').text()).toBe(t('setup.warning.browserOnly'));
    expect(wrapper.get('[data-testid="runtime-preset-toggle"]').element.tagName).toBe('FIELDSET');
    expect(wrapper.findAll('input[data-testid^="runtime-preset-"]')).toHaveLength(3);
    expect(wrapper.get('[data-testid="install-steps"]').element.tagName).toBe('OL');
    expect(wrapper.findAll('[data-testid="install-step"]')).toHaveLength(6);
    expect(wrapper.get('[data-testid="setup-dismiss"]').attributes('type')).toBe('button');

    for (const input of wrapper.findAll('input[type="radio"]')) {
      expect(input.attributes('id')).toBeTruthy();
      expect(wrapper.find(`label[for="${input.attributes('id')}"]`).exists()).toBe(true);
    }
  });

  test('regenerates the installGuide command and reveals the WebUI-only Nginx step', async () => {
    const wrapper = mount(SetupWelcome, { props: { t: createTranslator('en') } });

    expect(wrapper.get('[data-testid="install-command"] code').text()).toBe(buildInstallCommand('cli', 'core'));
    expect(wrapper.text()).not.toContain('Nginx');

    await wrapper.get('[data-testid="install-mode-webui"]').setValue(true);
    await wrapper.get('[data-testid="runtime-preset-web"]').setValue(true);

    expect(wrapper.get('[data-testid="install-command"] code').text()).toBe(buildInstallCommand('webui', 'web'));
    expect(wrapper.findAll('[data-testid="install-step"]')).toHaveLength(7);
    expect(wrapper.text()).toContain('Nginx');
  });

  test('uses the supplied translator for visible labels and emits dismissal', async () => {
    const t = createTranslator('zh-CN');
    const wrapper = mount(SetupWelcome, { props: { t } });

    expect(wrapper.get('[data-testid="setup-title"]').text()).toBe(t('setup.title'));
    expect(wrapper.get('[data-testid="setup-dismiss"]').text()).toBe(t('setup.dismiss'));
    expect(wrapper.get('[data-testid="install-mode-toggle"] legend').text()).toBe(t('setup.mode'));
    expect(wrapper.get('.setup-cautions').attributes('aria-label')).toBe(t('setup.guide'));
    expect(wrapper.get('.setup-cautions').text()).toContain(t('setup.warning.publicPages'));
    expect(wrapper.get('.setup-cautions').text()).toContain(t('setup.warning.cors'));

    await wrapper.get('[data-testid="setup-dismiss"]').trigger('click');

    expect(wrapper.emitted('dismiss')).toHaveLength(1);
  });

  test('offers the locale switcher on the first-visit page', async () => {
    const wrapper = mount(SetupWelcome, { props: { t: createTranslator('en'), locale: 'en' } });

    await wrapper.get('[data-testid="locale-switcher"] [data-locale="zh-CN"]').trigger('click');

    expect(wrapper.emitted('changeLocale')).toEqual([['zh-CN']]);
  });

  test('ships focused responsive styles without fixed or dialog positioning', () => {
    const guideSource = readFileSync(resolve(process.cwd(), 'src/components/SetupGuide.vue'), 'utf8');
    const setupStyles = readFileSync(resolve(process.cwd(), 'src/styles/setup.css'), 'utf8');

    expect(guideSource).toContain("import '../styles/setup.css'");
    expect(setupStyles).toContain('overflow-x: clip');
    expect(setupStyles).toContain('min-width: 0');
    expect(setupStyles).toContain('max-width: 100%');
    expect(setupStyles).toContain('@media (max-width: 767px)');
    expect(setupStyles).toContain(':root[data-theme="dark"] .setup-welcome__actions button');
    expect(setupStyles).not.toMatch(/position:\s*(fixed|absolute)/);
  });
});
