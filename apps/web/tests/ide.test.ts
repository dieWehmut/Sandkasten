import { flushPromises, mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import type { EditorView } from '@codemirror/view';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import App from '../src/App.vue';
import SourceEditor from '../src/components/SourceEditor.vue';
import WorkspaceExplorer from '../src/components/ide/WorkspaceExplorer.vue';
import { useWorkspace } from '../src/composables/useWorkspace';
import { useIdeLayout } from '../src/composables/useIdeLayout';
import { languageForPath } from '../src/editor/language';
import { SCRATCH_FILE_NAME, SCRATCH_FILE_SOURCE, WORKSPACE_STORAGE_KEY } from '../src/services/workspaceStore';
import type { DesktopBridge } from '../src/services/desktopBridge';
import type { Runtime } from '../src/services/sandkastenApi';
import { SETUP_WELCOME_STORAGE_KEY } from '../src/composables/useSetupWelcome';

const api = vi.hoisted(() => ({
  loadRuntimes: vi.fn(),
  submitJob: vi.fn(),
  pollJob: vi.fn(),
}));

vi.mock('../src/services/sandkastenApi', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/services/sandkastenApi')>(),
  loadRuntimes: api.loadRuntimes,
  submitJob: api.submitJob,
  pollJob: api.pollJob,
}));

const runtimes: Runtime[] = [
  { language: 'python', version: '3.13', default_entrypoint: 'main.py' },
  { language: 'javascript', version: '24' },
];

function stubBridge(overrides: Partial<DesktopBridge> = {}): DesktopBridge & { workspace: Record<string, ReturnType<typeof vi.fn>>; runner: Record<string, ReturnType<typeof vi.fn>> } {
  const files: Record<string, string> = {
    'main.py': 'print("disk")\n',
    'pkg/util.py': 'print("util")\n',
  };
  const bridge = {
    platform: 'win32',
    versions: { electron: '38.0.0' },
    workspace: {
      openFolder: vi.fn(async () => ({ path: 'C:\\ws', name: 'ws' })),
      root: vi.fn(async () => ({ path: 'C:\\ws', name: 'ws' })),
      list: vi.fn(async () => [
        { path: 'pkg', name: 'pkg', type: 'directory' as const, children: [{ path: 'pkg/util.py', name: 'util.py', type: 'file' as const }] },
        ...Object.keys(files)
          .filter((path) => !path.startsWith('pkg/'))
          .sort((left, right) => left.localeCompare(right))
          .map((path) => ({ path, name: path.split('/').at(-1) ?? path, type: 'file' as const })),
      ]),
      read: vi.fn(async (path: string) => files[path] ?? ''),
      write: vi.fn(async (path: string, content: string) => { files[path] = content; }),
      create: vi.fn(async (path: string, content: string) => { files[path] = content; }),
      remove: vi.fn(async (path: string) => { delete files[path]; }),
    },
    runner: {
      detect: vi.fn(async () => [
        { language: 'python', label: 'Python', command: 'python', available: true, extensions: ['.py'] },
        { language: 'go', label: 'Go', command: 'go', available: false, extensions: ['.go'] },
      ]),
      run: vi.fn(async (request: { jobId: string; language: string }) => ({
        jobId: request.jobId,
        status: 'JOB_STATUS_SUCCEEDED',
        language: request.language,
        stdout: 'local hello\n',
        stderr: '',
        stdoutEncoding: 'utf8',
        stderrEncoding: 'utf8',
        exitCode: 0,
        durationMs: 12,
      })),
      stop: vi.fn(async () => true),
    },
    isolated: {
      detect: vi.fn(async () => ({ available: true, distro: 'Ubuntu-22.04', pidIsolated: true, networkBlocked: true })),
      run: vi.fn(async (request: { jobId: string; language: string }) => ({
        jobId: request.jobId,
        status: 'JOB_STATUS_SUCCEEDED',
        language: request.language,
        stdout: 'isolated hello\n',
        stderr: '',
        stdoutEncoding: 'utf8',
        stderrEncoding: 'utf8',
        exitCode: 0,
        durationMs: 21,
      })),
      stop: vi.fn(async () => true),
    },
    onMenuCommand: vi.fn(),
    ...overrides,
  };
  return bridge as unknown as DesktopBridge & { workspace: Record<string, ReturnType<typeof vi.fn>>; runner: Record<string, ReturnType<typeof vi.fn>> };
}

function installBridge(bridge: DesktopBridge): void {
  (window as unknown as { sandkastenDesktop?: DesktopBridge }).sandkastenDesktop = bridge;
}

function editorViewOf(wrapper: ReturnType<typeof mount>): EditorView {
  const editor = wrapper.getComponent(SourceEditor);
  return (editor.vm as unknown as { editorView: EditorView }).editorView;
}

describe('workspace store and language detection', () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => window.localStorage.clear());

  test('maps file extensions to canonical runtimes', () => {
    expect(languageForPath('main.py')).toBe('python');
    expect(languageForPath('src/app.TSX')).toBe('tsx');
    expect(languageForPath('pkg\\util.go')).toBe('go');
    expect(languageForPath('README.md')).toBe('markdown');
    expect(languageForPath('LICENSE')).toBe('');
    expect(languageForPath('')).toBe('');
  });

  test('seeds a scratch workspace and persists edits, files, and deletion', async () => {
    const workspace = useWorkspace();
    await workspace.initialize();
    expect(workspace.store.kind).toBe('memory');
    expect(workspace.activePath.value).toBe(SCRATCH_FILE_NAME);
    expect(workspace.activeFile.value?.source).toBe(SCRATCH_FILE_SOURCE);
    expect(workspace.activeFile.value?.language).toBe('python');

    workspace.updateSource('print("edited")\n');
    expect(workspace.activeFile.value?.dirty).toBe(true);
    expect(await workspace.saveActive()).toBe(true);
    expect(workspace.activeFile.value?.dirty).toBe(false);
    const stored = JSON.parse(window.localStorage.getItem(WORKSPACE_STORAGE_KEY) ?? '{}') as { files?: Record<string, string> };
    expect(stored.files?.[SCRATCH_FILE_NAME]).toBe('print("edited")\n');

    await workspace.createFile('helper.js');
    expect(workspace.files.value.map((file) => file.path)).toEqual([SCRATCH_FILE_NAME, 'helper.js']);
    expect(workspace.activeFile.value?.language).toBe('javascript');
    expect(workspace.tree.value.map((node) => node.path)).toEqual(['helper.js', SCRATCH_FILE_NAME]);

    await workspace.removeFile('helper.js');
    expect(workspace.files.value.map((file) => file.path)).toEqual([SCRATCH_FILE_NAME]);
    await expect(workspace.createFile('bad/name.py')).rejects.toThrow(/path separators/);
    expect(workspace.error.value).toMatch(/path separators/);
  });

  test('closing a tab activates the neighbouring editor', async () => {
    const workspace = useWorkspace();
    await workspace.initialize();
    await workspace.createFile('second.py');
    workspace.closeFile('second.py');
    expect(workspace.activePath.value).toBe(SCRATCH_FILE_NAME);
    workspace.setActive(SCRATCH_FILE_NAME);
    workspace.closeFile(SCRATCH_FILE_NAME);
    expect(workspace.activePath.value).toBe('');
  });
});

describe('ide layout', () => {
  test('selecting the active activity collapses the sidebar', () => {
    const layout = useIdeLayout();
    expect(layout.activity.value).toBe('explorer');
    expect(layout.sidebarVisible.value).toBe(true);
    layout.selectActivity('explorer');
    expect(layout.sidebarVisible.value).toBe(false);
    layout.selectActivity('runs');
    expect(layout.activity.value).toBe('runs');
    expect(layout.sidebarVisible.value).toBe(true);
    layout.toggleSidebar();
    expect(layout.sidebarVisible.value).toBe(false);
    layout.togglePanel();
    expect(layout.panelVisible.value).toBe(false);
    layout.showPanel();
    expect(layout.panelVisible.value).toBe(true);
  });
});

describe('workspace explorer', () => {
  test('renders folders, marks dirty files, and collapses directories', async () => {
    const wrapper = mount(WorkspaceExplorer, {
      props: {
        tree: [
          { path: 'pkg', name: 'pkg', type: 'directory', children: [{ path: 'pkg/util.py', name: 'util.py', type: 'file' }] },
          { path: 'main.py', name: 'main.py', type: 'file' },
        ],
        root: { path: '/ws', name: 'ws' },
        kind: 'desktop',
        activePath: 'main.py',
        dirtyPaths: ['main.py'],
      },
    });

    expect(wrapper.findAll('[role="treeitem"]')).toHaveLength(3);
    expect(wrapper.get('[data-path="main.py"] .ide-tree__row').classes()).toContain('ide-tree__row--active');
    expect(wrapper.get('[data-path="main.py"] .ide-tree__dirty').text()).toBe('*');

    await wrapper.get('[data-path="pkg"] button').trigger('click');
    expect(wrapper.findAll('[role="treeitem"]')).toHaveLength(2);

    await wrapper.get('[data-path="main.py"] .ide-tree__open').trigger('click');
    expect(wrapper.emitted('select')).toEqual([['main.py']]);
    await wrapper.get('[data-path="main.py"] .ide-tree__remove').trigger('click');
    expect(wrapper.emitted('remove')).toEqual([['main.py']]);
  });
});

describe('desktop workbench', () => {
  beforeEach(() => {
    window.localStorage.setItem(SETUP_WELCOME_STORAGE_KEY, 'true');
    api.loadRuntimes.mockReset().mockResolvedValue(runtimes);
    api.submitJob.mockReset();
    api.pollJob.mockReset();
  });

  afterEach(() => {
    delete (window as unknown as { sandkastenDesktop?: DesktopBridge }).sandkastenDesktop;
    window.localStorage.clear();
  });

  test('renders the editor-first shell with explorer, tabs, panel, and status bar', async () => {
    const bridge = stubBridge();
    installBridge(bridge);
    const wrapper = mount(App);
    await flushPromises();

    wrapper.get('[data-testid="ide-activity-bar"]');
    wrapper.get('[data-testid="workspace-explorer"]');
    wrapper.get('[data-testid="editor-tabs"]');
    wrapper.get('[data-testid="ide-status-bar"]');
    expect(wrapper.get('[data-testid="ide-status-bar"]').attributes('data-backend')).toBe('local');
    expect(wrapper.get('[data-path="main.py"]').text()).toContain('main.py');
    expect(editorViewOf(wrapper).state.doc.toString()).toBe('print("disk")\n');
    expect(bridge.workspace.read).toHaveBeenCalledWith('main.py');

    await wrapper.get('[data-path="pkg/util.py"] .ide-tree__open').trigger('click');
    await flushPromises();
    expect(editorViewOf(wrapper).state.doc.toString()).toBe('print("util")\n');

    await wrapper.get('[data-action="ide-tab-main.py"]').trigger('click');
    await nextTick();
    expect(editorViewOf(wrapper).state.doc.toString()).toBe('print("disk")\n');

    await wrapper.get('[data-action="ide-close-main.py"]').trigger('click');
    await nextTick();
    expect(wrapper.find('[data-action="ide-tab-main.py"]').exists()).toBe(false);
  });

  test('header section buttons switch the sidebar section without collapsing it', async () => {
    const bridge = stubBridge();
    installBridge(bridge);
    const wrapper = mount(App);
    await flushPromises();

    const historyButton = wrapper.get('[data-action="toggle-history"]');
    await historyButton.trigger('click');
    await flushPromises();
    expect(wrapper.get('.ide-sidebar__title').text()).toBe('Recent runs');

    await historyButton.trigger('click');
    await flushPromises();
    expect(wrapper.find('.ide-sidebar').exists()).toBe(true);
    expect(wrapper.get('.ide-sidebar__title').text()).toBe('Recent runs');

    await wrapper.get('[data-action="toggle-inspector"]').trigger('click');
    await flushPromises();
    expect(wrapper.get('.ide-sidebar__title').text()).toBe('Inspector');
    expect(wrapper.get('#inspector-panel').exists()).toBe(true);
    expect(wrapper.find('.ide-sidebar').exists()).toBe(true);
  });

  test('keeps the sidebar collapse control at the top-right of the sidebar header', async () => {
    const bridge = stubBridge();
    installBridge(bridge);
    const wrapper = mount(App);
    await flushPromises();

    const header = wrapper.get('.ide-sidebar__header');
    expect(header.get('.ide-sidebar__title').text()).toBe('ws');
    const controls = header.findAll('button').map((button) => button.attributes('data-action'));
    expect(controls.at(-1)).toBe('ide-collapse-sidebar');
    expect(controls).toEqual(['ide-new-file', 'ide-open-folder', 'ide-refresh-tree', 'ide-collapse-sidebar']);
    expect(header.get('[data-action="ide-collapse-sidebar"]').attributes('aria-label')).toContain('Collapse sidebar');

    await header.get('[data-action="ide-collapse-sidebar"]').trigger('click');
    await nextTick();
    expect(wrapper.find('.ide-sidebar').exists()).toBe(false);
    expect(wrapper.find('[data-action="ide-refresh-tree"]').exists()).toBe(false);

    await wrapper.get('[data-activity="runs"]').trigger('click');
    await flushPromises();
    expect(wrapper.get('.ide-sidebar__title').text()).toBe('Recent runs');
    expect(wrapper.get('[data-action="ide-collapse-sidebar"]').exists()).toBe(true);
    expect(wrapper.find('[data-action="ide-refresh-tree"]').exists()).toBe(false);
    expect(wrapper.find('.run-history .pane-heading').exists()).toBe(false);

    await wrapper.get('[data-activity="context"]').trigger('click');
    await flushPromises();
    expect(wrapper.get('.ide-sidebar__title').text()).toBe('Inspector');
    expect(wrapper.get('#inspector-panel').exists()).toBe(true);
    expect(wrapper.find('.inspector-panel .pane-heading').exists()).toBe(false);
  });

  test('keeps every workbench region reachable through the scrollable body', async () => {
    const bridge = stubBridge();
    installBridge(bridge);
    const wrapper = mount(App);
    await flushPromises();

    const body = wrapper.get('.ide-body');
    expect(body.find('.ide-editor').exists()).toBe(true);
    expect(body.find('.job-timeline').exists()).toBe(true);
    expect(body.find('.ide-panel').exists()).toBe(true);
    expect(body.find('.ide-status').exists()).toBe(false);

    const main = wrapper.get('.ide-main');
    expect(main.attributes('aria-label')).toBe('Source workbench');
    expect(main.element.lastElementChild?.className).toContain('ide-status');
  });

  test('runs the active file with the local toolchain and shows its output', async () => {
    const bridge = stubBridge();
    installBridge(bridge);
    const wrapper = mount(App);
    await flushPromises();

    expect(wrapper.get<HTMLSelectElement>('[data-testid="ide-backend-select"]').element.value).toBe('local');
    await wrapper.get('button[aria-label="Run source"]').trigger('click');
    await flushPromises();

    expect(bridge.workspace.write).toHaveBeenCalledWith('main.py', 'print("disk")\n');
    expect(bridge.runner.run).toHaveBeenCalledTimes(1);
    const request = bridge.runner.run.mock.calls[0][0] as { path: string; language: string; jobId: string };
    expect(request.path).toBe('main.py');
    expect(request.language).toBe('python');
    expect(request.jobId).toMatch(/^local-/);
    expect(wrapper.text()).toContain('local hello');
    expect(wrapper.get('[data-testid="ide-status-phase"]').text()).toBe('Succeeded');
    expect(api.submitJob).not.toHaveBeenCalled();
  });

  test('refuses an unsupported local runtime and can switch back to the API backend', async () => {
    const bridge = stubBridge();
    installBridge(bridge);
    const wrapper = mount(App);
    await flushPromises();

    await wrapper.get('[aria-label="Runtime"]').setValue('javascript');
    await nextTick();
    expect(wrapper.get('button[aria-label="Run source"]').attributes('disabled')).toBeDefined();

    await wrapper.get('[data-testid="ide-backend-select"]').setValue('api');
    await flushPromises();
    expect(wrapper.get('button[aria-label="Run source"]').attributes('disabled')).toBeUndefined();

    api.submitJob.mockResolvedValue({ jobId: 'job-1', status: 'JOB_STATUS_SUCCEEDED', stdout: 'api hello\n', stdoutEncoding: 'utf8' });
    await wrapper.get('button[aria-label="Run source"]').trigger('click');
    await flushPromises();
    expect(api.submitJob).toHaveBeenCalledWith('javascript', 'print("disk")\n');
    expect(wrapper.text()).toContain('api hello');
  });

  test('saves dirty buffers, creates, and deletes workspace files', async () => {
    const bridge = stubBridge();
    installBridge(bridge);
    const wrapper = mount(App);
    await flushPromises();

    const view = editorViewOf(wrapper);
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'print("changed")\n' } });
    await nextTick();
    expect(wrapper.get('.ide-tab__dirty').text()).toBe('*');

    await wrapper.get('[data-action="ide-save-file"]').trigger('click');
    await flushPromises();
    expect(bridge.workspace.write).toHaveBeenLastCalledWith('main.py', 'print("changed")\n');
    expect(wrapper.find('.ide-tab__dirty').exists()).toBe(false);

    await wrapper.get('[data-action="ide-new-file"]').trigger('click');
    await wrapper.get('input[name="fileName"]').setValue('helper.py');
    await wrapper.get('[data-testid="ide-new-file-form"]').trigger('submit');
    await flushPromises();
    expect(bridge.workspace.create).toHaveBeenCalledTimes(1);
    expect(bridge.workspace.create.mock.calls[0][0]).toBe('helper.py');
    expect(wrapper.text()).toContain('helper.py');

    await wrapper.get('[data-path="helper.py"] .ide-tree__remove').trigger('click');
    await flushPromises();
    expect(bridge.workspace.remove).toHaveBeenCalledWith('helper.py');
  });

  test('opens a folder from the explorer and replies to menu commands', async () => {
    const bridge = stubBridge();
    installBridge(bridge);
    const wrapper = mount(App);
    await flushPromises();

    await wrapper.get('[data-action="ide-open-folder"]').trigger('click');
    await flushPromises();
    expect(bridge.workspace.openFolder).toHaveBeenCalledTimes(1);

    const handler = bridge.onMenuCommand.mock.calls[0][0] as (command: string) => void;
    handler('view.togglePanel');
    await nextTick();
    expect(wrapper.find('.ide-panel').exists()).toBe(false);
    handler('view.togglePanel');
    await nextTick();
    expect(wrapper.find('.ide-panel').exists()).toBe(true);

    handler('file.new');
    await nextTick();
    expect(wrapper.find('[data-testid="ide-new-file-form"]').exists()).toBe(true);
  });

  test('runs the active file inside the WSL2 sandbox when the isolated backend is selected', async () => {
    const bridge = stubBridge();
    installBridge(bridge);
    const wrapper = mount(App);
    await flushPromises();

    const select = wrapper.get<HTMLSelectElement>('[data-testid="ide-backend-select"]');
    expect(select.find('option[value="isolated"]').exists()).toBe(true);
    await select.setValue('isolated');
    await flushPromises();

    expect(wrapper.get('[data-testid="ide-status-bar"]').attributes('data-backend')).toBe('isolated');
    expect(wrapper.get('.ide-status__badge').text()).toBe('Isolated run');

    await wrapper.get('button[aria-label="Run source"]').trigger('click');
    await flushPromises();

    // The isolated backend still writes the buffer first, because the payload
    // reads the file from disk inside the distro.
    expect(bridge.workspace.write).toHaveBeenCalledWith('main.py', 'print("disk")\n');
    expect(bridge.isolated.detect).toHaveBeenCalled();
    expect(bridge.isolated.run).toHaveBeenCalledTimes(1);
    expect(bridge.runner.run).not.toHaveBeenCalled();
    const request = bridge.isolated.run.mock.calls[0][0] as { path: string; language: string; command: string; args: string[]; jobId: string };
    expect(request.path).toBe('main.py');
    expect(request.language).toBe('python');
    expect(request.command).toBe('python3');
    expect(request.args).toEqual(['{file}']);
    expect(request.jobId).toMatch(/^local-/);
    expect(wrapper.text()).toContain('isolated hello');
    expect(wrapper.get('[data-testid="ide-status-phase"]').text()).toBe('Succeeded');
    expect(api.submitJob).not.toHaveBeenCalled();
  });

  test('cancels an isolated run through the isolated bridge, not the local one', async () => {
    const bridge = stubBridge();
    let release: (() => void) | undefined;
    bridge.isolated.run.mockImplementation(async (request: { jobId: string; language: string }) => {
      await new Promise<void>((resolve) => { release = resolve; });
      return {
        jobId: request.jobId,
        status: 'JOB_STATUS_CANCELED',
        language: request.language,
        stdout: '',
        stderr: '',
        stdoutEncoding: 'utf8',
        stderrEncoding: 'utf8',
      };
    });
    installBridge(bridge);
    const wrapper = mount(App);
    await flushPromises();

    await wrapper.get('[data-testid="ide-backend-select"]').setValue('isolated');
    await flushPromises();
    await wrapper.get('button[aria-label="Run source"]').trigger('click');
    await flushPromises();

    await wrapper.get('button[aria-label="Stop run"]').trigger('click');
    await flushPromises();
    expect(bridge.isolated.stop).toHaveBeenCalledTimes(1);
    expect(bridge.runner.stop).not.toHaveBeenCalled();
    release?.();
    await flushPromises();
  });

  test('keeps the isolated backend unavailable when WSL2 cannot sandbox', async () => {
    const bridge = stubBridge({
      isolated: {
        detect: vi.fn(async () => ({ available: false, distro: '', pidIsolated: false, networkBlocked: false })),
        run: vi.fn(),
        stop: vi.fn(async () => false),
      } as unknown as DesktopBridge['isolated'],
    });
    installBridge(bridge);
    const wrapper = mount(App);
    await flushPromises();

    expect(wrapper.get<HTMLOptionElement>('[data-testid="ide-backend-select"] option[value="isolated"]').element.disabled).toBe(true);
    expect(wrapper.get('[data-testid="ide-backend-select"] option[value="isolated"]').attributes('title')).toContain('WSL2');
  });

  test('keeps the browser build from offering either desktop backend', async () => {
    const wrapper = mount(App);
    await flushPromises();

    expect(wrapper.get<HTMLOptionElement>('[data-testid="ide-backend-select"] option[value="local"]').element.disabled).toBe(true);
    expect(wrapper.get<HTMLOptionElement>('[data-testid="ide-backend-select"] option[value="isolated"]').element.disabled).toBe(true);
  });  test('keeps the browser build on the in-memory workspace and the API backend', async () => {
    const wrapper = mount(App);
    await flushPromises();

    wrapper.get('[data-testid="ide-status-bar"]');
    expect(wrapper.get('[data-testid="ide-status-bar"]').attributes('data-backend')).toBe('api');
    expect(wrapper.get<HTMLOptionElement>('[data-testid="ide-backend-select"] option[value="local"]').element.disabled).toBe(true);
    expect(wrapper.find('[data-action="ide-open-folder"]').exists()).toBe(false);
    expect(wrapper.get('[data-path="main.py"]').text()).toContain('main.py');
  });
});
