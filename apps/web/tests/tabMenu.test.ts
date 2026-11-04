import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import App from '../src/App.vue';
import EditorTabs from '../src/components/ide/EditorTabs.vue';
import { planTabClose, tabMenuEntries } from '../src/editor/tabMenu';
import { createTranslator } from '../src/i18n/locale';
import { SETUP_WELCOME_STORAGE_KEY } from '../src/composables/useSetupWelcome';
import type { DesktopBridge } from '../src/services/desktopBridge';
import type { Runtime } from '../src/services/sandkastenApi';

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

const t = createTranslator('en');
const runtimes: Runtime[] = [{ language: 'python', version: '3.13', default_entrypoint: 'main.py' }];

function stubBridge(): DesktopBridge {
  const files: Record<string, string> = {
    'main.py': 'print("disk")\n',
    'pkg/util.py': 'print("util")\n',
    'notes.txt': 'notes\n',
  };
  return {
    platform: 'win32',
    versions: { electron: '38.0.0' },
    workspace: {
      openFolder: vi.fn(async () => ({ path: 'C:\\ws', name: 'ws' })),
      root: vi.fn(async () => ({ path: 'C:\\ws', name: 'ws' })),
      list: vi.fn(async () => [
        { path: 'pkg', name: 'pkg', type: 'directory' as const, children: [{ path: 'pkg/util.py', name: 'util.py', type: 'file' as const }] },
        { path: 'main.py', name: 'main.py', type: 'file' as const },
        { path: 'notes.txt', name: 'notes.txt', type: 'file' as const },
      ]),
      read: vi.fn(async (path: string) => files[path] ?? ''),
      write: vi.fn(async (path: string, content: string) => { files[path] = content; }),
      create: vi.fn(async (path: string, content: string) => { files[path] = content; }),
      remove: vi.fn(async (path: string) => { delete files[path]; }),
    },
    runner: {
      detect: vi.fn(async () => [{ language: 'python', label: 'Python', command: 'python', available: true, extensions: ['.py'] }]),
      run: vi.fn(async (request: { jobId: string; language: string }) => ({
        jobId: request.jobId, status: 'JOB_STATUS_SUCCEEDED', language: request.language,
        stdout: 'ok\n', stderr: '', stdoutEncoding: 'utf8', stderrEncoding: 'utf8', exitCode: 0, durationMs: 1,
      })),
      stop: vi.fn(async () => true),
    },
    isolated: { detect: vi.fn(async () => ({ available: false, runtimes: [] })) },
  } as unknown as DesktopBridge;
}

function installBridge(bridge: DesktopBridge): void {
  // The app reads `window.sandkastenDesktop`, not a nested `sandkasten.desktop`.
  (window as unknown as { sandkastenDesktop?: DesktopBridge }).sandkastenDesktop = bridge;
}

enableAutoUnmount(afterEach);

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(SETUP_WELCOME_STORAGE_KEY, 'true');
  api.loadRuntimes.mockResolvedValue(runtimes);
  api.submitJob.mockReset();
  api.pollJob.mockReset();
});

afterEach(() => {
  delete (window as unknown as { sandkastenDesktop?: unknown }).sandkastenDesktop;
});

// The tree renders `pkg` unfolded, so opening a file inside it is one click.
async function openUtilFile(wrapper: ReturnType<typeof mount>): Promise<void> {
  await wrapper.get('[data-path="pkg/util.py"] .ide-tree__open').trigger('click');
  await flushPromises();
}

// `MouseEvent.button` is a read-only getter, so `trigger('auxclick', { button: 1 })`
// throws; dispatch the event by hand instead.
function fire(element: Element, type: string, init: MouseEventInit = {}): void {
  element.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, ...init }));
}

// jsdom has no layout, so every `getBoundingClientRect()` is all zeroes and the
// left-half/right-half test in `onDragOver` could never see a real edge. Lay the
// tabs out synthetically, 120 px apart, the width `fit` sizing gives them.
function stubTabBoxes(wrapper: ReturnType<typeof mount>): void {
  wrapper.findAll('.ide-tab').forEach((tab, index) => {
    const left = index * 120;
    tab.element.getBoundingClientRect = () => ({
      left, right: left + 120, top: 0, bottom: 32, width: 120, height: 32, x: left, y: 0,
      toJSON: () => ({}),
    }) as DOMRect;
  });
}

describe('tab context menu', () => {
  test('lists the reference close family in its own order and wording', () => {
    const entries = tabMenuEntries(t, { index: 1, total: 3, dirtyCount: 0 });
    const items = entries.flatMap((entry) => (entry.kind === 'item' ? [entry.label] : []));
    // Labels read from `nls.messages.json` of the installed build.
    expect(items).toEqual([
      'Close', 'Close Others', 'Close to the Right', 'Close Saved', 'Close All',
      'Copy Path', 'Reveal in Explorer View',
    ]);
    // The close family is one group, the file actions another.
    expect(entries.filter((entry) => entry.kind === 'separator')).toHaveLength(1);
    expect(entries.findIndex((entry) => entry.kind === 'separator')).toBe(5);
  });

  test('disables the rows that cannot act on the clicked tab', () => {
    // An entry without a `disabled` key is enabled, so `undefined` means "acts".
    const disabled = (entries: ReturnType<typeof tabMenuEntries>, id: string) => {
      const entry = entries.find((candidate) => candidate.kind === 'item' && candidate.id === id);
      return entry?.kind === 'item' ? Boolean(entry.disabled) : undefined;
    };

    // One tab only: nothing to the right, nothing "other", nothing saved to keep.
    const single = tabMenuEntries(t, { index: 0, total: 1, dirtyCount: 1 });
    expect(disabled(single, 'close')).toBe(false);
    expect(disabled(single, 'closeOthers')).toBe(true);
    expect(disabled(single, 'closeRight')).toBe(true);
    expect(disabled(single, 'closeSaved')).toBe(true);
    expect(disabled(single, 'closeAll')).toBe(false);

    // The last tab has nothing to its right; a fully saved strip can close saved.
    const last = tabMenuEntries(t, { index: 2, total: 3, dirtyCount: 0 });
    expect(disabled(last, 'closeRight')).toBe(true);
    expect(disabled(last, 'closeSaved')).toBe(false);
    expect(disabled(last, 'closeOthers')).toBe(false);
  });

  test('plans each close action without ever silently dropping unsaved work', () => {
    const paths = ['a.py', 'b.py', 'c.py'];
    const dirty = ['b.py'];

    expect(planTabClose('close', paths, 'b.py', dirty)).toEqual({ close: [], ask: ['b.py'] });
    expect(planTabClose('closeOthers', paths, 'a.py', dirty)).toEqual({ close: ['c.py'], ask: ['b.py'] });
    expect(planTabClose('closeRight', paths, 'a.py', dirty)).toEqual({ close: ['c.py'], ask: ['b.py'] });
    expect(planTabClose('closeSaved', paths, 'a.py', dirty)).toEqual({ close: ['a.py', 'c.py'], ask: [] });
    expect(planTabClose('closeAll', paths, 'a.py', dirty)).toEqual({ close: ['a.py', 'c.py'], ask: ['b.py'] });
    // Not a close action, or a path that is not open.
    expect(planTabClose('copyPath', paths, 'a.py', dirty)).toBeUndefined();
    expect(planTabClose('close', paths, 'missing.py', dirty)).toBeUndefined();
  });

  test('right-clicking a tab opens the menu and makes that tab active', async () => {
    const wrapper = mount(EditorTabs, {
      props: {
        files: [
          { path: 'a.py', name: 'a.py', dirty: false },
          { path: 'b.py', name: 'b.py', dirty: true },
        ],
        activePath: 'a.py',
      },
    });
    expect(wrapper.find('[data-testid="context-menu"]').exists()).toBe(false);

    await wrapper.findAll('.ide-tab')[1].trigger('contextmenu', { clientX: 120, clientY: 80 });
    await nextTick();

    // The clicked tab became the selection, as the reference does before showing
    // the menu, so its commands act on the tab under the pointer.
    expect(wrapper.emitted('select')?.at(-1)).toEqual(['b.py']);
    const menu = wrapper.get('[data-testid="context-menu"]');
    expect(menu.attributes('role')).toBe('menu');
    expect(menu.attributes('aria-label')).toBe('Editor actions');
    expect(menu.text()).toContain('Close Others');
    // One of the two buffers is unsaved, so Close Saved has something to close.
    expect(wrapper.get('[data-action="context-menu-closeSaved"]').attributes('disabled')).toBeUndefined();
  });

  test('choosing a close row emits the paths that action targets', async () => {
    const wrapper = mount(EditorTabs, {
      props: {
        files: [
          { path: 'a.py', name: 'a.py', dirty: false },
          { path: 'b.py', name: 'b.py', dirty: false },
          { path: 'c.py', name: 'c.py', dirty: false },
        ],
        activePath: 'b.py',
      },
    });
    await wrapper.findAll('.ide-tab')[1].trigger('contextmenu', { clientX: 10, clientY: 10 });
    await nextTick();
    await wrapper.get('[data-action="context-menu-closeRight"]').trigger('click');
    expect(wrapper.emitted('closeMany')?.at(-1)).toEqual([['c.py']]);

    await wrapper.findAll('.ide-tab')[1].trigger('contextmenu', { clientX: 10, clientY: 10 });
    await nextTick();
    await wrapper.get('[data-action="context-menu-closeOthers"]').trigger('click');
    expect(wrapper.emitted('closeMany')?.at(-1)).toEqual([['a.py', 'c.py']]);

    // The file actions travel as their own events.
    await wrapper.findAll('.ide-tab')[1].trigger('contextmenu', { clientX: 10, clientY: 10 });
    await nextTick();
    await wrapper.get('[data-action="context-menu-copyPath"]').trigger('click');
    expect(wrapper.emitted('copyPath')?.at(-1)).toEqual(['b.py']);

    await wrapper.findAll('.ide-tab')[1].trigger('contextmenu', { clientX: 10, clientY: 10 });
    await nextTick();
    await wrapper.get('[data-action="context-menu-reveal"]').trigger('click');
    expect(wrapper.emitted('reveal')?.at(-1)).toEqual(['b.py']);
  });

  test('closing a clean tab from the menu leaves no prompt behind', async () => {
    installBridge(stubBridge());
    const wrapper = mount(App);
    await flushPromises();

    await openUtilFile(wrapper);
    expect(wrapper.findAll('.ide-tab')).toHaveLength(2);

    await wrapper.findAll('.ide-tab')[1].trigger('contextmenu', { clientX: 10, clientY: 10 });
    await nextTick();
    await wrapper.get('[data-action="context-menu-close"]').trigger('click');
    await nextTick();

    // A saved buffer closes straight away, with no discard prompt in the way.
    expect(wrapper.find('[data-testid="discard-dialog"]').exists()).toBe(false);
    expect(wrapper.findAll('.ide-tab')).toHaveLength(1);
  });

  test('a middle click closes a background tab without activating it', async () => {
    const wrapper = mount(EditorTabs, {
      props: {
        files: [
          { path: 'a.py', name: 'a.py', dirty: false },
          { path: 'b.py', name: 'b.py', dirty: false },
        ],
        activePath: 'a.py',
      },
    });
    const background = wrapper.findAll('.ide-tab')[1].element;

    // The right button also fires `auxclick`; it must not close anything.
    fire(background, 'auxclick', { button: 2 });
    await nextTick();
    expect(wrapper.emitted('close')).toBeUndefined();

    fire(background, 'auxclick', { button: 1 });
    await nextTick();
    expect(wrapper.emitted('close')?.at(-1)).toEqual(['b.py']);
    // The reference closes with `preserveFocus`, so the strip's selection stays put.
    expect(wrapper.emitted('select')).toBeUndefined();
  });

  test('dragging a tab asks for its new position in the strip', async () => {
    const wrapper = mount(EditorTabs, {
      props: {
        files: [
          { path: 'a.py', name: 'a.py', dirty: false },
          { path: 'b.py', name: 'b.py', dirty: false },
          { path: 'c.py', name: 'c.py', dirty: false },
        ],
        activePath: 'a.py',
      },
    });
    const tabs = wrapper.findAll('.ide-tab');
    stubTabBoxes(wrapper);
    // jsdom has no DataTransfer, so the handlers must survive its absence.
    fire(tabs[0].element, 'dragstart');
    await nextTick();
    expect(wrapper.findAll('.ide-tab')[0].classes()).toContain('ide-tab--dragging');

    // Dropping on the right half of the last tab means "after it", i.e. the end.
    fire(tabs[2].element, 'dragover', { clientX: 359 });
    await nextTick();
    expect(wrapper.findAll('.ide-tab')[2].classes()).toContain('ide-tab--drop-after');
    fire(tabs[2].element, 'drop', { clientX: 359 });
    await nextTick();
    expect(wrapper.emitted('move')?.at(-1)).toEqual([{ from: 'a.py', toIndex: 2 }]);
    expect(wrapper.findAll('.ide-tab')[0].classes()).not.toContain('ide-tab--dragging');

    // Dropping on the left half of the first tab means "before it", i.e. index 0.
    fire(tabs[2].element, 'dragstart');
    await nextTick();
    fire(tabs[0].element, 'dragover', { clientX: 1 });
    await nextTick();
    expect(wrapper.findAll('.ide-tab')[0].classes()).toContain('ide-tab--drop-before');
    fire(tabs[0].element, 'drop', { clientX: 1 });
    await nextTick();
    expect(wrapper.emitted('move')?.at(-1)).toEqual([{ from: 'c.py', toIndex: 0 }]);
  });

  test('dragging a tab reorders the strip without changing the selection', async () => {
    installBridge(stubBridge());
    const wrapper = mount(App);
    await flushPromises();

    await openUtilFile(wrapper);
    await wrapper.get('[data-path="notes.txt"] .ide-tree__open').trigger('click');
    await flushPromises();
    const names = () => wrapper.findAll('.ide-tab__name').map((node) => node.text());
    expect(names()).toEqual(['main.py', 'util.py', 'notes.txt']);
    const activeBefore = wrapper.get('.ide-tab--active .ide-tab__name').text();

    // Drag the first tab onto the right half of the last one: it lands at the end.
    const tabs = wrapper.findAll('.ide-tab');
    stubTabBoxes(wrapper);
    fire(tabs[0].element, 'dragstart');
    fire(tabs[2].element, 'dragover', { clientX: 359 });
    fire(tabs[2].element, 'drop', { clientX: 359 });
    await flushPromises();

    expect(names()).toEqual(['util.py', 'notes.txt', 'main.py']);
    // Reordering is not selecting: the same buffer stays active.
    expect(wrapper.get('.ide-tab--active .ide-tab__name').text()).toBe(activeBefore);
    // The drag state is cleared, so no tab keeps the drop marker.
    expect(wrapper.findAll('.ide-tab--dragging, .ide-tab--drop-before, .ide-tab--drop-after')).toHaveLength(0);

    // Dragging it back to the left half of the first tab returns it to the front.
    const again = wrapper.findAll('.ide-tab');
    stubTabBoxes(wrapper);
    fire(again[2].element, 'dragstart');
    fire(again[0].element, 'dragover', { clientX: 1 });
    fire(again[0].element, 'drop', { clientX: 1 });
    await flushPromises();
    expect(names()).toEqual(['main.py', 'util.py', 'notes.txt']);
  });

  test('a bulk close leaves clean tabs closed and prompts for the unsaved one', async () => {
    installBridge(stubBridge());
    const wrapper = mount(App);
    await flushPromises();

    await openUtilFile(wrapper);
    expect(wrapper.findAll('.ide-tab')).toHaveLength(2);

    // Close Others from the first tab: the other tab is saved, so it goes at once.
    await wrapper.findAll('.ide-tab')[0].trigger('contextmenu', { clientX: 10, clientY: 10 });
    await nextTick();
    await wrapper.get('[data-action="context-menu-closeOthers"]').trigger('click');
    await nextTick();

    expect(wrapper.find('[data-testid="discard-dialog"]').exists()).toBe(false);
    expect(wrapper.findAll('.ide-tab')).toHaveLength(1);
    expect(wrapper.get('.ide-tab__name').text()).toBe('main.py');
  });
});
