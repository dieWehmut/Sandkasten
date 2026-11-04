import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import App from '../src/App.vue';
import IdeSash from '../src/components/ide/IdeSash.vue';
import { useIdeLayout } from '../src/composables/useIdeLayout';
import {
  DEFAULT_WORKBENCH_SETTINGS,
  PANEL_MAX_HEIGHT,
  PANEL_MIN_HEIGHT,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  normalizeUserSettings,
} from '../src/state/editorSettings';
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

const runtimes: Runtime[] = [{ language: 'python', version: '3.13', default_entrypoint: 'main.py' }];

function stubBridge(): DesktopBridge {
  const files: Record<string, string> = { 'main.py': 'print("disk")\n' };
  return {
    platform: 'win32',
    versions: { electron: '38.0.0' },
    workspace: {
      openFolder: vi.fn(async () => ({ path: 'C:\\ws', name: 'ws' })),
      root: vi.fn(async () => ({ path: 'C:\\ws', name: 'ws' })),
      list: vi.fn(async () => [{ path: 'main.py', name: 'main.py', type: 'file' as const }]),
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
  (window as unknown as { sandkasten?: { desktop: DesktopBridge } }).sandkasten = { desktop: bridge };
}

// jsdom has no `PointerEvent`, and `MouseEvent.button` is a getter, so the
// pointer handlers are exercised by dispatching a mouse event under a pointer
// event name — the same shape the handlers read in a browser.
async function fire(element: Element, type: string, init: MouseEventInit = {}): Promise<void> {
  element.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, ...init }));
  await nextTick();
}

enableAutoUnmount(afterEach);

beforeEach(() => {
  localStorage.clear();
  // Without this the app opens on the install guide instead of the workbench.
  localStorage.setItem(SETUP_WELCOME_STORAGE_KEY, 'true');
  api.loadRuntimes.mockResolvedValue(runtimes);
  api.submitJob.mockReset();
  api.pollJob.mockReset();
});

afterEach(() => {
  delete (window as unknown as { sandkasten?: unknown }).sandkasten;
});

describe('pane splitter', () => {
  test('the layout controller clamps both pane sizes to the reference bounds', () => {
    const layout = useIdeLayout();
    expect(layout.sidebarWidth.value).toBe(DEFAULT_WORKBENCH_SETTINGS.sidebarWidth);
    expect(layout.panelHeight.value).toBe(DEFAULT_WORKBENCH_SETTINGS.panelHeight);

    layout.resizeSidebar(412);
    expect(layout.sidebarWidth.value).toBe(412);
    layout.resizeSidebar(SIDEBAR_MIN_WIDTH - 200);
    expect(layout.sidebarWidth.value).toBe(SIDEBAR_MIN_WIDTH);
    layout.resizeSidebar(SIDEBAR_MAX_WIDTH + 5000);
    expect(layout.sidebarWidth.value).toBe(SIDEBAR_MAX_WIDTH);

    layout.resizePanel(240);
    expect(layout.panelHeight.value).toBe(240);
    layout.resizePanel(1);
    expect(layout.panelHeight.value).toBe(PANEL_MIN_HEIGHT);
    layout.resizePanel(PANEL_MAX_HEIGHT * 4);
    expect(layout.panelHeight.value).toBe(PANEL_MAX_HEIGHT);

    // A fractional drag lands on a whole pixel so the grid never accumulates
    // sub-pixel drift while the pointer moves.
    layout.resizeSidebar(311.6);
    expect(layout.sidebarWidth.value).toBe(312);

    layout.resetPaneSizes();
    expect(layout.sidebarWidth.value).toBe(DEFAULT_WORKBENCH_SETTINGS.sidebarWidth);
    expect(layout.panelHeight.value).toBe(DEFAULT_WORKBENCH_SETTINGS.panelHeight);
  });

  test('stored pane sizes survive a reload and out-of-range values fall back', () => {
    expect(normalizeUserSettings({ workbench: { sidebarWidth: 380, panelHeight: 420 } }).workbench)
      .toMatchObject({ sidebarWidth: 380, panelHeight: 420 });
    // Untrusted input cannot configure an unusable pane.
    expect(normalizeUserSettings({ workbench: { sidebarWidth: 5, panelHeight: 99999 } }).workbench)
      .toMatchObject({ sidebarWidth: DEFAULT_WORKBENCH_SETTINGS.sidebarWidth, panelHeight: DEFAULT_WORKBENCH_SETTINGS.panelHeight });
    expect(normalizeUserSettings({ workbench: { sidebarWidth: 'wide', panelHeight: null } }).workbench)
      .toMatchObject({ sidebarWidth: DEFAULT_WORKBENCH_SETTINGS.sidebarWidth, panelHeight: DEFAULT_WORKBENCH_SETTINGS.panelHeight });
  });

  test('the sash reports itself as a window splitter and moves on pointer and keys', async () => {
    const wrapper = mount(IdeSash, { props: { value: 300, min: 170, max: 720, label: 'Sidebar size' } });
    const sash = wrapper.get('.ide-sash');
    expect(sash.attributes('role')).toBe('separator');
    expect(sash.attributes('aria-orientation')).toBe('vertical');
    expect(sash.attributes('aria-label')).toBe('Sidebar size');
    expect(sash.attributes('aria-valuenow')).toBe('300');
    expect(sash.attributes('aria-valuemin')).toBe('170');
    expect(sash.attributes('aria-valuemax')).toBe('720');
    expect(sash.attributes('tabindex')).toBe('0');

    // Dragging right grows the pane on a vertical sash.
    const element = sash.element;
    await fire(element, 'pointerdown', { button: 0, clientX: 300 });
    await fire(element, 'pointermove', { clientX: 356 });
    expect(wrapper.emitted('resize')?.at(-1)).toEqual([356]);
    await fire(element, 'pointerup', { clientX: 356 });
    // Once the drag ends, further motion is ignored.
    await fire(element, 'pointermove', { clientX: 500 });
    expect(wrapper.emitted('resize')).toHaveLength(1);

    // The clamp is applied against the bounds the owner handed down.
    await fire(element, 'pointerdown', { button: 0, clientX: 300 });
    await fire(element, 'pointermove', { clientX: 9000 });
    expect(wrapper.emitted('resize')?.at(-1)).toEqual([720]);
    await fire(element, 'pointerup', { clientX: 9000 });

    // Arrow keys step, Shift steps further, Home and End jump to the bounds.
    await sash.trigger('keydown', { key: 'ArrowRight' });
    expect(wrapper.emitted('resize')?.at(-1)).toEqual([310]);
    await sash.trigger('keydown', { key: 'ArrowLeft', shiftKey: true });
    expect(wrapper.emitted('resize')?.at(-1)).toEqual([250]);
    await sash.trigger('keydown', { key: 'Home' });
    expect(wrapper.emitted('resize')?.at(-1)).toEqual([170]);
    await sash.trigger('keydown', { key: 'End' });
    expect(wrapper.emitted('resize')?.at(-1)).toEqual([720]);
    // An unrelated key leaves the size alone.
    const before = wrapper.emitted('resize')?.length;
    await sash.trigger('keydown', { key: 'a' });
    expect(wrapper.emitted('resize')).toHaveLength(before ?? 0);
  });

  test('a horizontal sash grows the pane above it when dragged up', async () => {
    const wrapper = mount(IdeSash, { props: { orientation: 'horizontal', value: 300, min: 100, max: 1200, label: 'Panel size' } });
    const sash = wrapper.get('.ide-sash');
    expect(sash.attributes('aria-orientation')).toBe('horizontal');

    await fire(sash.element, 'pointerdown', { button: 0, clientY: 600 });
    await fire(sash.element, 'pointermove', { clientY: 540 });
    expect(wrapper.emitted('resize')?.at(-1)).toEqual([360]);

    // ArrowUp grows a bottom panel, ArrowDown shrinks it.
    await sash.trigger('keydown', { key: 'ArrowUp' });
    expect(wrapper.emitted('resize')?.at(-1)).toEqual([310]);
    await sash.trigger('keydown', { key: 'ArrowDown' });
    expect(wrapper.emitted('resize')?.at(-1)).toEqual([290]);
  });

  test('double-clicking a sash restores the reference defaults', async () => {
    const wrapper = mount(IdeSash, { props: { value: 512, min: 170, max: 720, label: 'Sidebar size' } });
    await wrapper.get('.ide-sash').trigger('dblclick');
    expect(wrapper.emitted('reset')).toHaveLength(1);
  });

  test('the shell renders both sashes and writes the sizes into the grid', async () => {
    installBridge(stubBridge());
    const wrapper = mount(App);
    await flushPromises();

    const shell = wrapper.get('[data-testid="workbench-shell"]');
    // The reference's defaults, as CSS variables the stylesheet reads.
    expect(shell.attributes('style')).toContain('--ide-sidebar-width: 300px');
    expect(shell.attributes('style')).toContain('--ide-panel-height: 300px');

    const sidebarSash = wrapper.get('.ide-sash--sidebar');
    expect(sidebarSash.attributes('role')).toBe('separator');
    expect(sidebarSash.attributes('aria-label')).toBe('Sidebar size');
    expect(sidebarSash.attributes('aria-valuenow')).toBe('300');

    const panelSash = wrapper.get('.ide-sash--panel');
    expect(panelSash.attributes('aria-orientation')).toBe('horizontal');
    expect(panelSash.attributes('aria-valuenow')).toBe('300');

    // A drag writes through the controller and back into the persisted setting.
    await fire(sidebarSash.element, 'pointerdown', { button: 0, clientX: 300 });
    await fire(sidebarSash.element, 'pointermove', { clientX: 380 });
    await fire(sidebarSash.element, 'pointerup', { clientX: 380 });
    await nextTick();
    expect(wrapper.get('[data-testid="workbench-shell"]').attributes('style')).toContain('--ide-sidebar-width: 380px');
    expect(wrapper.get('.ide-sash--sidebar').attributes('aria-valuenow')).toBe('380');
    const stored = JSON.parse(localStorage.getItem('sandkasten-user-settings-v1') ?? '{}');
    expect(stored.workbench.sidebarWidth).toBe(380);
  });

  test('the panel sash disappears while the panel is maximized or hidden', async () => {
    installBridge(stubBridge());
    const wrapper = mount(App);
    await flushPromises();

    expect(wrapper.find('.ide-sash--panel').exists()).toBe(true);
    // A maximized panel has no height to drag, so the reference hides its sash.
    await wrapper.get('[data-action="ide-panel-maximize"]').trigger('click');
    await nextTick();
    expect(wrapper.find('.ide-sash--panel').exists()).toBe(false);

    await wrapper.get('[data-action="ide-panel-close"]').trigger('click');
    await nextTick();
    expect(wrapper.find('.ide-sash--panel').exists()).toBe(false);

    // The sidebar's sash follows the sidebar's own visibility.
    expect(wrapper.find('.ide-sash--sidebar').exists()).toBe(true);
    await wrapper.get('[data-action="ide-collapse-sidebar"]').trigger('click');
    await nextTick();
    expect(wrapper.find('.ide-sash--sidebar').exists()).toBe(false);
  });

  test('the palette offers the pane reset and applies it', async () => {
    installBridge(stubBridge());
    const wrapper = mount(App);
    await flushPromises();

    const sidebarSash = wrapper.get('.ide-sash--sidebar');
    await fire(sidebarSash.element, 'pointerdown', { button: 0, clientX: 300 });
    await fire(sidebarSash.element, 'pointermove', { clientX: 460 });
    await fire(sidebarSash.element, 'pointerup', { clientX: 460 });
    await nextTick();
    expect(wrapper.get('[data-testid="workbench-shell"]').attributes('style')).toContain('--ide-sidebar-width: 460px');

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'P', ctrlKey: true, shiftKey: true }));
    await flushPromises();
    await wrapper.get('[data-command="view.resetPaneSizes"]').trigger('click');
    await flushPromises();
    expect(wrapper.get('[data-testid="workbench-shell"]').attributes('style')).toContain('--ide-sidebar-width: 300px');
    expect(wrapper.get('[data-testid="workbench-shell"]').attributes('style')).toContain('--ide-panel-height: 300px');
  });
});
