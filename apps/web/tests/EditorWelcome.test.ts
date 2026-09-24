import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, test, vi } from 'vitest';
import WorkbenchShell from '../src/components/WorkbenchShell.vue';
import SourceEditor from '../src/components/SourceEditor.vue';
import { createTranslator, type Locale } from '../src/i18n/locale';
import { TRANSLATOR_KEY } from '../src/i18n/useTranslation';

const shellProps = {
  historyOpen: false,
  inspectorOpen: false,
  history: [],
  runtimes: [{ language: 'python', version: '3.13' }],
  language: 'python',
  source: '',
  phase: 'ready' as const,
  activeOutputTab: 'output' as const,
  canRun: false,
  canResume: false,
};

describe('empty editor welcome', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('replaces editor chrome until a file opens, and returns when the last file closes', async () => {
    const wrapper = mount(WorkbenchShell, { props: shellProps });
    expect(wrapper.find('[data-testid="editor-welcome"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="editor-tabs"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="ide-breadcrumbs"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="ide-toolbar"]').exists()).toBe(false);
    expect(wrapper.findComponent(SourceEditor).exists()).toBe(false);

    await wrapper.setProps({
      files: [{ path: 'main.py', name: 'main.py', language: 'python', source: 'print(1)', dirty: false }],
      activePath: 'main.py',
      source: 'print(1)',
    });
    expect(wrapper.find('[data-testid="editor-welcome"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="editor-tabs"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="ide-breadcrumbs"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="ide-toolbar"]').exists()).toBe(true);
    expect(wrapper.findComponent(SourceEditor).exists()).toBe(true);

    await wrapper.get('[data-action="ide-close-main.py"]').trigger('click');
    expect(wrapper.emitted('closeFile')).toEqual([['main.py']]);
    await wrapper.setProps({ files: [], activePath: '' });
    expect(wrapper.find('[data-testid="editor-welcome"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="editor-tabs"]').exists()).toBe(false);
    wrapper.unmount();
  });

  test.each([
    ['en', 'win32', 'New file', 'Open folder', 'Setup guide', 'Ctrl', 'Control+N'],
    ['zh-CN', 'darwin', '新建文件', '打开文件夹', '安装指南', 'Cmd', 'Meta+N'],
  ])('localizes actions and shows the working shortcut for %s on %s', async (locale, platform, newFile, openFolder, setup, modifier, shortcut) => {
    const wrapper = mount(WorkbenchShell, {
      props: { ...shellProps, workspaceKind: 'desktop', platform },
      global: { provide: { [TRANSLATOR_KEY as symbol]: createTranslator(locale as Locale) } },
    });
    const welcome = wrapper.get('[data-testid="editor-welcome"]');
    expect(welcome.get('img').attributes('src')).toBeTruthy();
    const newButton = welcome.get('[data-action="welcome-new-file"]');
    expect(newButton.text()).toContain(newFile);
    expect(newButton.attributes('aria-keyshortcuts')).toBe(shortcut);
    expect(newButton.findAll('kbd').map((key) => key.text())).toEqual([modifier, 'N']);
    await newButton.trigger('click');
    expect(wrapper.emitted('update:creatingFile')).toEqual([[true]]);

    const folderButton = welcome.get('[data-action="welcome-open-folder"]');
    expect(folderButton.text()).toBe(openFolder);
    expect(folderButton.find('kbd').exists()).toBe(false);
    expect(folderButton.attributes('aria-keyshortcuts')).toBeUndefined();
    await folderButton.trigger('click');
    expect(wrapper.emitted('openFolder')).toHaveLength(1);

    const setupButton = welcome.get('[data-action="welcome-open-setup"]');
    expect(setupButton.text()).toBe(setup);
    await setupButton.trigger('click');
    expect(wrapper.emitted('openSetup')).toHaveLength(1);
    wrapper.unmount();
  });

  test('omits folder access in the browser and detects its Mac shortcut', () => {
    vi.spyOn(window.navigator, 'platform', 'get').mockReturnValue('MacIntel');
    const wrapper = mount(WorkbenchShell, { props: shellProps });
    const welcome = wrapper.get('[data-testid="editor-welcome"]');
    expect(welcome.find('[data-action="welcome-open-folder"]').exists()).toBe(false);
    expect(welcome.get('[data-action="welcome-new-file"]').attributes('aria-keyshortcuts')).toBe('Meta+N');
    wrapper.unmount();
  });

  test('offers the next steps and lists the recently opened files', async () => {
    const wrapper = mount(WorkbenchShell, {
      props: { ...shellProps, recentFiles: ['main.py', 'pkg/util.py'] },
    });
    const welcome = wrapper.get('[data-testid="editor-welcome"]');

    // The page is the Get Started arrangement: a start column, a next-steps
    // column, and one tile per action.
    expect(welcome.get('.editor-welcome__title').text()).toBe('Sandkasten');
    expect(welcome.findAll('.editor-welcome__section-title').map((title) => title.text()))
      .toEqual(['Start', 'Recent', 'Next steps']);

    await welcome.get('[data-action="welcome-open-palette"]').trigger('click');
    expect(wrapper.emitted('openPalette')).toHaveLength(1);
    await welcome.get('[data-action="welcome-open-settings"]').trigger('click');
    expect(wrapper.emitted('openSettings')).toHaveLength(1);

    // Each recent row carries the file's glyph and its full path, and opens it.
    const rows = welcome.findAll('.editor-welcome__recent-item');
    expect(rows.map((row) => row.find('.editor-welcome__path').text())).toEqual(['main.py', 'pkg/util.py']);
    expect(rows[1].find('.file-icon').attributes('data-icon')).toBe('_f_python');
    await rows[1].trigger('click');
    expect(wrapper.emitted('selectFile')).toEqual([['pkg/util.py']]);
    expect(welcome.find('.editor-welcome__empty').exists()).toBe(false);
    wrapper.unmount();
  });

  test('says so when nothing has been opened yet, and names the platform modifier', () => {
    const wrapper = mount(WorkbenchShell, { props: { ...shellProps, platform: 'darwin' } });
    const welcome = wrapper.get('[data-testid="editor-welcome"]');
    expect(welcome.find('.editor-welcome__recent').exists()).toBe(false);
    expect(welcome.get('.editor-welcome__empty').text()).toBe('No recent files yet.');
    expect(welcome.get('.editor-welcome__footer').text()).toBe('Cmd+P opens a file, Cmd+Shift+P runs a command.');
    wrapper.unmount();
  });

});
