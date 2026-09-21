import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import WorkspaceSearch from '../src/components/ide/WorkspaceSearch.vue';
import { useWorkspaceSearch, type WorkspaceSearchResult } from '../src/composables/useWorkspaceSearch';
import type { DesktopBridge } from '../src/services/desktopBridge';

const resources = vi.hoisted(() => ({ result: undefined as WorkspaceSearchResult | undefined }));

vi.mock('../src/services/workspaceSearch', () => ({
  searchWorkspace: vi.fn(async () => resources.result),
}));

const { searchWorkspace } = await import('../src/services/workspaceSearch');

function stubBridge(overrides: Partial<DesktopBridge> = {}): DesktopBridge {
  return {
    platform: 'win32',
    versions: {},
    workspace: {
      openFolder: vi.fn(async () => null),
      root: vi.fn(async () => null),
      list: vi.fn(async () => []),
      read: vi.fn(async () => ''),
      write: vi.fn(),
      create: vi.fn(),
      createFolder: vi.fn(),
      remove: vi.fn(),
      search: vi.fn(),
    },
    runner: { detect: vi.fn(async () => []), run: vi.fn(), stop: vi.fn() },
    onMenuCommand: vi.fn(),
    ...overrides,
  } as unknown as DesktopBridge;
}

function installBridge(bridge?: DesktopBridge): void {
  if (bridge) (window as unknown as { sandkastenDesktop?: DesktopBridge }).sandkastenDesktop = bridge;
  else delete (window as unknown as { sandkastenDesktop?: DesktopBridge }).sandkastenDesktop;
}

beforeEach(() => {
  installBridge();
  resources.result = undefined;
  vi.mocked(searchWorkspace).mockClear();
});

describe('workspace search controller', () => {
  test('searches the open folder and reports files, matches, and truncation', async () => {
    resources.result = {
      query: 'alpha', caseSensitive: false, truncated: true, fileCount: 2, matchCount: 3,
      files: [
        { path: 'pkg/util.py', name: 'util.py', matches: [{ line: 4, text: 'return alpha' }, { line: 9, text: 'alpha += 1' }] },
        { path: 'notes.txt', name: 'notes.txt', matches: [{ line: 1, text: 'alpha' }] },
      ],
    };
    const controller = useWorkspaceSearch();

    await controller.run('alpha');
    expect(searchWorkspace).toHaveBeenCalledWith('alpha', false);
    expect(controller.state.value).toBe('ready');
    expect(controller.results.value.map((file) => file.path)).toEqual(['pkg/util.py', 'notes.txt']);
    expect(controller.matchCount.value).toBe(3);
    expect(controller.truncated.value).toBe(true);
    expect(controller.summary.value).toContain('3');
  });

  test('keeps an empty query idle and surfaces a failure instead of faking results', async () => {
    const controller = useWorkspaceSearch();
    await controller.run('   ');
    expect(searchWorkspace).not.toHaveBeenCalled();
    expect(controller.state.value).toBe('idle');

    vi.mocked(searchWorkspace).mockRejectedValueOnce(new Error('Search is available in the desktop app.'));
    await controller.run('alpha');
    expect(controller.state.value).toBe('error');
    expect(controller.error.value).toMatch(/desktop app/);
    expect(controller.results.value).toEqual([]);
  });

  test('passes the case toggle through and clears the last result set', async () => {
    resources.result = { query: 'Alpha', caseSensitive: true, truncated: false, fileCount: 0, matchCount: 0, files: [] };
    const controller = useWorkspaceSearch();

    await controller.run('Alpha', true);
    expect(searchWorkspace).toHaveBeenCalledWith('Alpha', true);
    expect(controller.state.value).toBe('empty');

    controller.clear();
    expect(controller.state.value).toBe('idle');
    expect(controller.query.value).toBe('');
  });
});

describe('workspace search view', () => {
  test('lists matching files with their lines and opens the chosen match', async () => {
    const wrapper = mount(WorkspaceSearch, {
      props: {
        state: 'ready',
        query: 'alpha',
        caseSensitive: false,
        files: [
          { path: 'pkg/util.py', name: 'util.py', matches: [{ line: 4, text: 'return alpha' }, { line: 9, text: 'alpha += 1' }] },
          { path: 'notes.txt', name: 'notes.txt', matches: [{ line: 1, text: 'alpha' }] },
        ],
        fileCount: 2,
        matchCount: 3,
        truncated: false,
        desktop: true,
      },
    });

    expect(wrapper.get('[data-testid="workspace-search"]').exists()).toBe(true);
    // One entry per matching file, one click target per matching line.
    expect(wrapper.findAll('[data-match-path]').length).toBe(2);
    expect(wrapper.findAll('.ide-search__line').length).toBe(3);
    expect(wrapper.get('[data-match-path="pkg/util.py"] .file-icon').attributes('data-icon')).toBe('_f_python');
    expect(wrapper.text()).toContain('3');

    await wrapper.get('[data-match-path="pkg/util.py"] [data-line="9"]').trigger('click');
    expect(wrapper.emitted('select')).toEqual([['pkg/util.py']]);

    await wrapper.get('[data-testid="workspace-search-case"]').setValue(true);
    expect(wrapper.emitted('update:caseSensitive')).toEqual([[true]]);
    await wrapper.get('[data-testid="workspace-search-input"]').setValue('beta');
    expect(wrapper.emitted('update:query')).toEqual([['beta']]);
  });

  test('explains what is missing in the browser and when nothing matches', async () => {
    const browser = mount(WorkspaceSearch, { props: { state: 'idle', query: '', desktop: false } });
    expect(browser.get('[data-testid="workspace-search-unavailable"]').text()).toMatch(/desktop/i);

    const empty = mount(WorkspaceSearch, { props: { state: 'empty', query: 'zzz', desktop: true } });
    expect(empty.get('[data-testid="workspace-search-empty"]').text()).toMatch(/zzz/);

    const truncated = mount(WorkspaceSearch, {
      props: {
        state: 'ready', query: 'a', desktop: true, truncated: true, fileCount: 1, matchCount: 1, caseSensitive: false,
        files: [{ path: 'main.py', name: 'main.py', matches: [{ line: 1, text: 'alpha' }] }],
      },
    });
    expect(truncated.get('[data-testid="workspace-search-truncated"]').text()).toMatch(/first/i);

    const failed = mount(WorkspaceSearch, { props: { state: 'error', query: 'a', desktop: true, error: 'Search failed' } });
    expect(failed.get('[role="alert"]').text()).toContain('Search failed');
  });

  test('runs the search from the form and forwards a change of the case toggle', async () => {
    const blank = mount(WorkspaceSearch, { props: { state: 'idle', query: '   ', desktop: true } });
    await blank.get('[data-testid="workspace-search-form"]').trigger('submit');
    expect(blank.emitted('search')).toBeUndefined();

    // The view is prop-driven: typing reports the draft, and the shell feeds the
    // accepted query back before submit runs it.
    const typed = mount(WorkspaceSearch, { props: { state: 'idle', query: 'alpha', desktop: true } });
    await typed.get('[data-testid="workspace-search-input"]').setValue('beta');
    expect(typed.emitted('update:query')).toEqual([['beta']]);
    await typed.get('[data-testid="workspace-search-form"]').trigger('submit');
    expect(typed.emitted('search')).toEqual([['alpha']]);

    await typed.get('[data-testid="workspace-search-clear"]').trigger('click');
    expect(typed.emitted('clear')).toHaveLength(1);
  });
});
