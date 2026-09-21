import { flushPromises, mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import type { EditorView } from '@codemirror/view';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import App from '../src/App.vue';
import SourceEditor from '../src/components/SourceEditor.vue';
import EditorTabs from '../src/components/ide/EditorTabs.vue';
import IdeBreadcrumbs from '../src/components/ide/IdeBreadcrumbs.vue';
import WorkspaceExplorer from '../src/components/ide/WorkspaceExplorer.vue';
import { useWorkspace } from '../src/composables/useWorkspace';
import { useIdeLayout } from '../src/composables/useIdeLayout';
import { languageForPath } from '../src/editor/language';
import { ancestorPaths, breadcrumbSegments } from '../src/editor/breadcrumbs';
import { windowTitle } from '../src/editor/windowTitle';
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

  test('creates nested folders that the tree then lists', async () => {
    const workspace = useWorkspace();
    await workspace.initialize();

    workspace.setActive(SCRATCH_FILE_NAME);
    expect(await workspace.createFolder('pkg/deep')).toBe('pkg/deep');
    // The folder itself never becomes the active editor, and the open scratch
    // file stays untouched while the tree gains the new directory.
    expect(workspace.activePath.value).toBe(SCRATCH_FILE_NAME);
    expect(workspace.tree.value.map((node) => `${node.type}:${node.path}`)).toEqual([
      'directory:pkg',
      `file:${SCRATCH_FILE_NAME}`,
    ]);
    expect(workspace.tree.value[0].children?.map((node) => `${node.type}:${node.path}`)).toEqual(['directory:pkg/deep']);
    expect(workspace.error.value).toBeUndefined();

    await expect(workspace.createFolder('../escape')).rejects.toThrow(/workspace|path/i);
    await expect(workspace.createFolder('')).rejects.toThrow(/folder name/i);
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
  test('names the open file and workspace in the window title', () => {
    expect(windowTitle({ appName: 'Sandkasten' })).toBe('Sandkasten');
    expect(windowTitle({ appName: 'Sandkasten', workspace: 'ws' })).toBe('ws \u2014 Sandkasten');
    expect(windowTitle({ appName: 'Sandkasten', workspace: 'ws', file: 'main.py' })).toBe('main.py \u2014 ws \u2014 Sandkasten');
    expect(windowTitle({ appName: 'Sandkasten', workspace: 'ws', file: 'main.py', dirty: true })).toBe('main.py \u2022 \u2014 ws \u2014 Sandkasten');
    // An unnamed workspace or file leaves no empty separator behind.
    expect(windowTitle({ appName: 'Sandkasten', workspace: '  ', file: '' })).toBe('Sandkasten');
  });

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

  test('maximizing the panel shows it, and hiding it clears the maximized state', () => {
    const layout = useIdeLayout();
    expect(layout.panelMaximized.value).toBe(false);

    layout.togglePanelMaximize();
    expect(layout.panelMaximized.value).toBe(true);
    expect(layout.panelVisible.value).toBe(true);

    layout.togglePanelMaximize();
    expect(layout.panelMaximized.value).toBe(false);

    // Hiding the panel drops the maximized state so reopening restores height.
    layout.togglePanelMaximize();
    expect(layout.panelMaximized.value).toBe(true);
    layout.togglePanel();
    expect(layout.panelVisible.value).toBe(false);
    expect(layout.panelMaximized.value).toBe(false);
    layout.showPanel();
    expect(layout.panelVisible.value).toBe(true);
    expect(layout.panelMaximized.value).toBe(false);
  });

});

describe('workspace explorer', () => {
  test('splits a file path into readable breadcrumb steps', () => {
    expect(breadcrumbSegments('main.py', 'C:\\ws')).toEqual([
      { path: '', name: 'ws', kind: 'root' },
      { path: '', name: 'main.py', kind: 'file' },
    ]);
    expect(breadcrumbSegments('pkg/deep/util.py', 'C:\\ws')).toEqual([
      { path: '', name: 'ws', kind: 'root' },
      { path: 'pkg', name: 'pkg', kind: 'directory' },
      { path: 'pkg/deep', name: 'deep', kind: 'directory' },
      { path: '', name: 'util.py', kind: 'file' },
    ]);
    expect(breadcrumbSegments('', 'C:\\ws')).toEqual([]);
    expect(breadcrumbSegments('C:\\ws', 'C:\\ws')).toEqual([]);
    // A file outside the open workspace keeps its own leading segments rather
    // than pretending to sit under a root it does not belong to.
    expect(breadcrumbSegments('D:\\other\\util.py', 'C:\\ws')).toEqual([
      { path: 'D:', name: 'D:', kind: 'directory' },
      { path: 'D:/other', name: 'other', kind: 'directory' },
      { path: '', name: 'util.py', kind: 'file' },
    ]);
  });

  test('lists the folders above a path so a reveal can open them', () => {
    expect(ancestorPaths('pkg/deep/util.py')).toEqual(['pkg', 'pkg/deep']);
    expect(ancestorPaths('main.py')).toEqual([]);
    expect(ancestorPaths('')).toEqual([]);
  });

  test('renders the trail with a clickable folder and a static file', async () => {
    const wrapper = mount(IdeBreadcrumbs, {
      props: { filePath: 'pkg/deep/util.py', rootPath: 'C:\\ws' },
    });

    const steps = wrapper.findAll('.ide-breadcrumbs__step');
    expect(steps.map((step) => step.text())).toEqual(['ws', 'pkg', 'deep', 'util.py']);
    expect(wrapper.findAll('button.ide-breadcrumbs__step').map((step) => step.text())).toEqual(['pkg', 'deep']);
    expect(wrapper.get('.ide-breadcrumbs__step--static .file-icon').attributes('data-icon')).toBe('_f_python');

    await wrapper.get('[data-segment="pkg"]').trigger('click');
    expect(wrapper.emitted('reveal')).toEqual([['pkg']]);
  });

  test('offers the reference header actions and folds every folder at once', async () => {
    const wrapper = mount(WorkspaceExplorer, {
      props: {
        tree: [
          {
            path: 'pkg',
            name: 'pkg',
            type: 'directory',
            children: [
              {
                path: 'pkg/deep',
                name: 'deep',
                type: 'directory',
                children: [{ path: 'pkg/deep/util.py', name: 'util.py', type: 'file' }],
              },
            ],
          },
          { path: 'src', name: 'src', type: 'directory', children: [{ path: 'src/app.ts', name: 'app.ts', type: 'file' }] },
          { path: 'main.py', name: 'main.py', type: 'file' },
        ],
        root: { path: '/ws', name: 'ws' },
        kind: 'desktop',
        activePath: 'main.py',
      },
    });

    // The reference header order: new file, new folder, refresh, collapse all.
    expect(wrapper.findAll('.ide-explorer__actions button').map((button) => button.attributes('data-action'))).toEqual([
      'ide-new-file',
      'ide-new-folder',
      'ide-refresh-tree',
      'ide-collapse-folders',
    ]);
    expect(wrapper.findAll('[role=treeitem]')).toHaveLength(6);

    await wrapper.get('[data-action=ide-collapse-folders]').trigger('click');
    // Collapsing folds the nested folder too, so only the top level remains.
    expect(wrapper.findAll('[role=treeitem]')).toHaveLength(3);
    expect(wrapper.get('.ide-explorer__collapse').attributes('data-collapsed')).toBe('true');
  });

  test('opens the new-file row inside the selected directory', async () => {
    const wrapper = mount(WorkspaceExplorer, {
      props: {
        tree: [
          { path: 'pkg', name: 'pkg', type: 'directory', children: [{ path: 'pkg/util.py', name: 'util.py', type: 'file' }] },
          { path: 'main.py', name: 'main.py', type: 'file' },
        ],
        root: { path: '/ws', name: 'ws' },
        kind: 'desktop',
        activePath: 'pkg/util.py',
      },
    });

    expect(wrapper.find('[data-testid=ide-inline-create]').exists()).toBe(false);
    await wrapper.get('[data-action=ide-new-file]').trigger('click');

    // The row lands under the selected file's directory, not at the panel top,
    // and carries the directory's depth so it lines up with its siblings.
    const row = wrapper.get('[data-testid=ide-inline-create]');
    expect(row.attributes('data-parent')).toBe('pkg');
    expect(row.attributes('data-depth')).toBe('1');
    expect(wrapper.get('[data-action=ide-new-file]').attributes('aria-pressed')).toBe('true');
  });

  test('creates a file in the selected directory without a folder field', async () => {
    const wrapper = mount(WorkspaceExplorer, {
      props: {
        tree: [
          { path: 'pkg', name: 'pkg', type: 'directory', children: [{ path: 'pkg/util.py', name: 'util.py', type: 'file' }] },
          { path: 'main.py', name: 'main.py', type: 'file' },
        ],
        root: { path: '/ws', name: 'ws' },
        kind: 'desktop',
        activePath: 'pkg/util.py',
      },
    });

    await wrapper.get('[data-action=ide-new-file]').trigger('click');
    // The form takes a name only: the location comes from the selection.
    expect(wrapper.find('[data-testid=ide-inline-create] input[name=fileFolder]').exists()).toBe(false);

    await wrapper.get('input[name=fileName]').setValue('helper.py');
    await wrapper.get('[data-testid=ide-new-file-form]').trigger('submit');
    expect(wrapper.emitted('create')).toEqual([[{ name: 'helper.py', language: 'python', folder: 'pkg' }]]);
    expect(wrapper.find('[data-testid=ide-inline-create]').exists()).toBe(false);
  });

  test('places the row as a sibling when the selection is a file at the root', async () => {
    const wrapper = mount(WorkspaceExplorer, {
      props: {
        tree: [{ path: 'main.py', name: 'main.py', type: 'file' }],
        root: { path: '/ws', name: 'ws' },
        kind: 'desktop',
        activePath: 'main.py',
      },
    });

    await wrapper.get('[data-action=ide-new-folder]').trigger('click');
    const row = wrapper.get('[data-testid=ide-inline-create]');
    // A root-level selection creates at the root, matching VS Code.
    expect(row.attributes('data-parent')).toBe('');
    expect(row.attributes('data-depth')).toBe('0');
    expect(row.attributes('data-kind')).toBe('folder');
  });

  test('creates a folder at the selection and reveals a folded target', async () => {
    const wrapper = mount(WorkspaceExplorer, {
      props: {
        tree: [
          {
            path: 'pkg',
            name: 'pkg',
            type: 'directory',
            children: [{ path: 'pkg/deep', name: 'deep', type: 'directory', children: [] }],
          },
        ],
        root: { path: '/ws', name: 'ws' },
        kind: 'desktop',
        activePath: 'pkg/deep/util.py',
      },
    });

    // Fold pkg, then start a creation inside it: the row must still be visible,
    // so the directories above the row open themselves.
    await wrapper.get('[data-path="pkg"] .ide-tree__toggle').trigger('click');
    expect(wrapper.find('[data-path="pkg/deep"]').exists()).toBe(false);

    await wrapper.get('[data-action=ide-new-folder]').trigger('click');
    expect(wrapper.get('[data-testid=ide-inline-create]').attributes('data-parent')).toBe('pkg/deep');

    await wrapper.get('input[name=folderName]').setValue('nested');
    await wrapper.get('[data-testid=ide-new-folder-form]').trigger('submit');
    expect(wrapper.emitted('createFolder')).toEqual([['pkg/deep/nested']]);
    expect(wrapper.find('[data-testid=ide-inline-create]').exists()).toBe(false);
  });

  test('creates at the root when the shell opens the row with nothing selected', async () => {
    const wrapper = mount(WorkspaceExplorer, {
      props: {
        tree: [{ path: 'main.py', name: 'main.py', type: 'file' }],
        root: { path: '/ws', name: 'ws' },
        kind: 'desktop',
        activePath: '',
        creating: true,
      },
    });

    // The welcome screen and the native Ctrl+N set the flag without a target,
    // and an empty selection must still land in the workspace root.
    const row = wrapper.get('[data-testid=ide-inline-create]');
    expect(row.attributes('data-parent')).toBe('');
    expect(row.attributes('data-depth')).toBe('0');

    await wrapper.get('input[name=fileName]').setValue('fresh.py');
    await wrapper.get('[data-testid=ide-new-file-form]').trigger('submit');
    expect(wrapper.emitted('create')).toEqual([[{ name: 'fresh.py', language: 'python', folder: '' }]]);
  });

  test('cancels the inline row with Escape and with the close control', async () => {
    const wrapper = mount(WorkspaceExplorer, {
      props: {
        tree: [{ path: 'main.py', name: 'main.py', type: 'file' }],
        root: { path: '/ws', name: 'ws' },
        kind: 'desktop',
        activePath: 'main.py',
      },
    });

    await wrapper.get('[data-action=ide-new-file]').trigger('click');
    await wrapper.get('[data-testid=ide-inline-create] input[name=fileName]').trigger('keydown', { key: 'Escape' });
    expect(wrapper.find('[data-testid=ide-inline-create]').exists()).toBe(false);

    await wrapper.get('[data-action=ide-new-file]').trigger('click');
    await wrapper.get('[data-testid=ide-inline-create] [data-action=ide-cancel-create]').trigger('click');
    expect(wrapper.find('[data-testid=ide-inline-create]').exists()).toBe(false);
  });

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

  test('marks each folder with the upstream folder glyph while it is collapsed and open', async () => {
    const wrapper = mount(WorkspaceExplorer, {
      props: {
        tree: [{ path: 'src', name: 'src', type: 'directory', children: [{ path: 'src/main.py', name: 'main.py', type: 'file' }] }],
        kind: 'desktop',
        activePath: 'src/main.py',
      },
    });

    // A directory starts expanded, so it shows the upstream open glyph and
    // switches to the closed one when it is folded.
    const folder = wrapper.get('[data-path="src"] .file-icon');
    expect(folder.attributes('data-kind')).toBe('folder');
    expect(folder.attributes('data-icon')).toBe('_fd_src_open');
    expect(folder.get('img').attributes('src')).toMatch(/^data:image\/svg\+xml,/);

    await wrapper.get('[data-path="src"] button').trigger('click');
    expect(wrapper.get('[data-path="src"] .file-icon').attributes('data-icon')).toBe('_fd_src');
  });

  test('marks each file with its vscode-icons glyph in the tree and the tab strip', async () => {
    const wrapper = mount(WorkspaceExplorer, {
      props: {
        tree: [
          { path: 'main.py', name: 'main.py', type: 'file' },
          { path: 'app.ts', name: 'app.ts', type: 'file' },
          { path: 'LICENSE', name: 'LICENSE', type: 'file' },
        ],
        kind: 'desktop',
        activePath: 'main.py',
      },
    });

    expect(wrapper.get('[data-path="main.py"] .file-icon').attributes('data-icon')).toBe('_f_python');
    expect(wrapper.get('[data-path="app.ts"] .file-icon').attributes('data-icon')).toBe('_f_typescript');
    expect(wrapper.get('[data-path="LICENSE"] .file-icon').attributes('data-icon')).toBe('_f_license');
    // Folders carry the upstream folder glyphs too, closed and expanded.
    expect(wrapper.get('[data-path="main.py"] .file-icon img').attributes('src')).toMatch(/^data:image\/svg\+xml,/);
    expect(wrapper.get('[data-path="main.py"] .file-icon').attributes('data-kind')).toBe('file');

    const tabs = mount(EditorTabs, {
      props: { files: [{ path: 'main.py', name: 'main.py', dirty: false }], activePath: 'main.py' },
    });
    expect(tabs.get('.ide-tab__select .file-icon').attributes('data-icon')).toBe('_f_python');
  });
});

describe('desktop workbench', () => {
  beforeEach(() => {
    // Start from a clean store: a previous test's persisted workspace would
    // otherwise decide which file this test opens on load.
    window.localStorage.clear();
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
    // The breadcrumb trail names the workspace root and the open file.
    expect(wrapper.get('[data-testid="ide-breadcrumbs"]').text()).toContain('ws');
    expect(wrapper.get('[data-testid="ide-breadcrumbs"]').text()).toContain('main.py');
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

  test('titles the window after the open file and workspace', async () => {
    const bridge = stubBridge();
    installBridge(bridge);
    const wrapper = mount(App);
    await flushPromises();

    // The scratch desktop workspace opens main.py from `ws` on load.
    expect(document.title).toBe('main.py \u2014 ws \u2014 Sandkasten');

    await wrapper.get('[data-path="pkg/util.py"] .ide-tree__open').trigger('click');
    await flushPromises();
    expect(document.title).toBe('util.py \u2014 ws \u2014 Sandkasten');
  });

  test('the panel header maximizes and closes the panel', async () => {
    const bridge = stubBridge();
    installBridge(bridge);
    const wrapper = mount(App);
    await flushPromises();

    expect(wrapper.find('.ide-panel').exists()).toBe(true);
    expect(wrapper.get('[data-testid="workbench-shell"]').classes()).not.toContain('panel-maximized');

    await wrapper.get('[data-action="ide-panel-maximize"]').trigger('click');
    await nextTick();
    expect(wrapper.get('[data-testid="workbench-shell"]').classes()).toContain('panel-maximized');

    await wrapper.get('[data-action="ide-panel-close"]').trigger('click');
    await nextTick();
    expect(wrapper.find('.ide-panel').exists()).toBe(false);
    expect(wrapper.get('[data-testid="workbench-shell"]').classes()).toContain('without-panel');
  });

  test('activity bar buttons switch the sidebar section without collapsing it', async () => {
    const bridge = stubBridge();
    installBridge(bridge);
    const wrapper = mount(App);
    await flushPromises();

    // The reduced title row has no section buttons, so the activity bar is the
    // route that switches the sidebar section. Switching between two different
    // sections keeps the sidebar open; re-selecting the active one is the
    // collapse gesture, which the next test covers.
    await wrapper.get('[data-activity="runs"]').trigger('click');
    await flushPromises();
    expect(wrapper.get('.ide-sidebar__title').text()).toBe('Recent runs');
    expect(wrapper.find('.ide-sidebar').exists()).toBe(true);

    await wrapper.get('[data-activity="context"]').trigger('click');
    await flushPromises();
    expect(wrapper.get('.ide-sidebar__title').text()).toBe('Inspector');
    expect(wrapper.get('#inspector-panel').exists()).toBe(true);
    expect(wrapper.find('.ide-sidebar').exists()).toBe(true);

    await wrapper.get('[data-activity="explorer"]').trigger('click');
    await flushPromises();
    expect(wrapper.get('.ide-sidebar').exists()).toBe(true);
    expect(wrapper.get('[data-activity="explorer"]').attributes('aria-pressed')).toBe('true');
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
    // The reference resource-manager header plus the sidebar collapse control:
    // new file, new folder, refresh, collapse folders, then collapse sidebar.
    expect(controls).toEqual([
      'ide-new-file',
      'ide-new-folder',
      'ide-refresh-tree',
      'ide-collapse-folders',
      'ide-collapse-sidebar',
    ]);
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

  test('searches the open folder from the activity bar and opens a chosen match', async () => {
    const bridge = stubBridge();
    const results = {
      query: 'disk', caseSensitive: false, truncated: false, fileCount: 1, matchCount: 1,
      files: [{ path: 'main.py', name: 'main.py', matches: [{ line: 1, text: 'print("disk")' }] }],
    };
    (bridge.workspace as unknown as { search: ReturnType<typeof vi.fn> }).search = vi.fn(async () => results);
    installBridge(bridge);
    const wrapper = mount(App);
    await flushPromises();

    await wrapper.get('[data-activity="search"]').trigger('click');
    await flushPromises();
    expect(wrapper.get('[data-testid="workspace-search"]').exists()).toBe(true);

    await wrapper.get('[data-testid="workspace-search-input"]').setValue('disk');
    await wrapper.get('[data-testid="workspace-search-form"]').trigger('submit');
    await flushPromises();
    // The main-process search receives just the query and the case flag.
    expect(bridge.workspace.search).toHaveBeenCalledWith({ query: 'disk', caseSensitive: false });
    expect(wrapper.get('[data-match-path="main.py"]').text()).toContain('disk');

    await wrapper.get('[data-match-path="main.py"] [data-line="1"]').trigger('click');
    await flushPromises();
    expect(bridge.workspace.read).toHaveBeenCalledWith('main.py');

    await wrapper.get('[data-testid="workspace-search-case"]').setValue(true);
    expect(wrapper.get('[data-testid="workspace-search-case"]').element.checked).toBe(true);
  });

  test('explains that search needs the desktop app in the browser build', async () => {
    const wrapper = mount(App);
    await flushPromises();

    await wrapper.get('[data-activity="search"]').trigger('click');
    await flushPromises();
    expect(wrapper.get('[data-testid="workspace-search-unavailable"]').text()).toMatch(/desktop/i);
    expect(wrapper.get<HTMLInputElement>('[data-testid="workspace-search-input"]').element.disabled).toBe(true);
  });

  test('lists the SSH hosts and hands a chosen one to the terminal session', async () => {
    const bridge = stubBridge();
    const opened: Array<{ host: string; directory?: string }> = [];
    (bridge as unknown as { remote: Record<string, ReturnType<typeof vi.fn>> }).remote = {
      list: vi.fn(async () => ({
        available: true,
        configPath: 'C:\\Users\\me\\.ssh\\config',
        hosts: [{ alias: 'sandkasten', hostName: '192.168.50.11', user: 'root', port: '2222', directories: ['/root/sandkasten'] }],
      })),
      remember: vi.fn(async () => ({ available: true, configPath: '', hosts: [] })),
      forget: vi.fn(async () => ({ available: true, configPath: '', hosts: [] })),
      open: vi.fn(async (request: { host: string; directory?: string }) => {
        opened.push(request);
        return { host: request.host, command: `ssh ${request.host}`, directory: request.directory ?? '' };
      }),
    };
    installBridge(bridge);
    const wrapper = mount(App);
    await flushPromises();

    await wrapper.get('[data-activity="remote"]').trigger('click');
    await flushPromises();
    expect(wrapper.find('[data-testid="remote-explorer"]').exists()).toBe(true);
    expect(wrapper.get('[data-host="sandkasten"]').text()).toContain('192.168.50.11');
    expect(wrapper.find('[data-directory="/root/sandkasten"]').exists()).toBe(true);

    // This bridge exposes no terminal, so the hand-off is a no-op rather than a
    // half-connection: the app never pretends a session exists.
    await wrapper.get('[data-open="sandkasten"]').trigger('click');
    await flushPromises();
    expect(opened).toEqual([]);
  });

  test('explains that the remote explorer needs the desktop app in the browser build', async () => {
    const wrapper = mount(App);
    await flushPromises();

    await wrapper.get('[data-activity="remote"]').trigger('click');
    await flushPromises();
    expect(wrapper.get('[data-testid="remote-desktop-only"]').text()).toMatch(/desktop/i);
  });

  test('opens a folder from the File menu and replies to menu commands', async () => {
    const bridge = stubBridge();
    installBridge(bridge);
    const wrapper = mount(App);
    await flushPromises();

    // The Explorer header carries the reference's four resource actions, so
    // "Open folder" stays reachable from the File menu and the palette instead.
    expect(wrapper.find('[data-action="ide-open-folder"]').exists()).toBe(false);
    const openFolderFromMenu = bridge.onMenuCommand.mock.calls[0][0] as (command: string) => void;
    openFolderFromMenu('workspace.open');
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
