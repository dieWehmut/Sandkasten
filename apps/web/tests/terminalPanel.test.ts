import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import App from '../src/App.vue';
import { SETUP_WELCOME_STORAGE_KEY } from '../src/composables/useSetupWelcome';
import type { DesktopBridge, TerminalBridge } from '../src/services/desktopBridge';

vi.mock('../src/services/sandkastenApi', async (original) => ({
  ...await original<typeof import('../src/services/sandkastenApi')>(), loadRuntimes: vi.fn(async () => []),
}));
vi.mock('@xterm/xterm', () => ({ Terminal: class {
  cols = 80; rows = 24; options: any; host?: HTMLElement; text = '';
  constructor(options: any) { this.options = options; }
  open(host: HTMLElement) { this.host = host; host.innerHTML = '<textarea class="xterm-helper-textarea"></textarea><span></span>'; this.write(''); }
  write(data: string) { this.text += data; if (this.host) this.host.querySelector('span')!.textContent = this.text; }
  loadAddon() {} attachCustomKeyEventHandler() {} dispose() {} refresh() {}
  focus() { this.host?.querySelector('textarea')?.focus(); }
  onData() { return { dispose() {} }; } onResize() { return { dispose() {} }; }
} }));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit() {} } }));

let wrapper: ReturnType<typeof mount> | undefined;
let menu: (command: string) => void;
let data: (event: { id: string; data: string }) => void;
function installDesktop() {
  let index = 0;
  const terminal = {
    profiles: vi.fn(async () => [{ id: 'pwsh', label: 'PowerShell', isDefault: true }, { id: 'cmd', label: 'Command Prompt' }]),
    create: vi.fn(async ({ profileId }: { profileId?: string }) => ({ id: `s${++index}`, profileId: profileId ?? 'pwsh', title: profileId ?? 'PowerShell', cwd: 'C:\\workspace' })),
    attach: vi.fn(async (id: string) => { data({ id, data: 'prompt> ' }); }),
    write: vi.fn(async () => {}), resize: vi.fn(async () => {}), close: vi.fn(async () => {}),
    setFocused: vi.fn(async (_focused: boolean) => {}),
    onData: vi.fn((handler) => { data = handler; return vi.fn(); }), onExit: vi.fn(() => vi.fn()),
  } satisfies TerminalBridge;
  const bridge: DesktopBridge = {
    platform: 'win32', versions: {}, terminal,
    workspace: { root: vi.fn(async () => null), list: vi.fn(async () => []), openFolder: vi.fn(async () => null), read: vi.fn(async () => ''), write: vi.fn(), create: vi.fn(), remove: vi.fn() },
    runner: { detect: vi.fn(async () => []), run: vi.fn(), stop: vi.fn() },
    onMenuCommand: (handler) => { menu = handler; },
  };
  (window as any).sandkastenDesktop = bridge;
  return terminal;
}
async function mountApp() {
  wrapper = mount(App, { attachTo: document.body, global: { stubs: { SourceEditor: true } } });
  await flushPromises(); return wrapper;
}
beforeEach(() => { window.localStorage.clear(); window.localStorage.setItem(SETUP_WELCOME_STORAGE_KEY, 'true'); });
afterEach(() => { wrapper?.unmount(); wrapper = undefined; delete (window as any).sandkastenDesktop; vi.unstubAllGlobals(); });

describe('desktop terminal panel', () => {
  test('only adds the terminal tab when the desktop terminal capability exists', async () => {
    const browser = await mountApp();
    expect(browser.find('[data-action="select-output-terminal"]').exists()).toBe(false);
    browser.unmount(); installDesktop(); const desktop = await mountApp();
    await desktop.get('[data-action="select-output-terminal"]').trigger('click'); await flushPromises();
    expect(desktop.get('[data-testid="terminal-panel"]').text()).toContain('prompt>');
  });

  test('creates discovered profiles, switches, splits and closes sessions through real controls', async () => {
    const bridge = installDesktop(); const app = await mountApp();
    await app.get('[data-action="select-output-terminal"]').trigger('click'); await flushPromises();
    await app.get('[data-testid="terminal-profile"]').setValue('cmd'); await flushPromises();
    expect(bridge.create).toHaveBeenLastCalledWith({ profileId: 'cmd', cols: 80, rows: 24 });
    expect(app.findAll('[data-testid="terminal-session"]')).toHaveLength(2);
    await app.get('[data-action="terminal-split"]').trigger('click'); await flushPromises();
    expect(app.findAll('[data-testid="terminal-pane"]')).toHaveLength(2);
    await app.get('[data-testid="terminal-session"][data-session-id="s1"]').trigger('click');
    expect(app.get('[data-testid="terminal-pane"][data-session-id="s1"]').attributes('data-active')).toBe('true');
    await app.get('[data-action="terminal-close"]').trigger('click'); await flushPromises();
    expect(bridge.close).toHaveBeenCalledWith('s1');
  });

  test('retains output and shell identity across output tabs, panel hiding and setup guide', async () => {
    const bridge = installDesktop(); const app = await mountApp(); menu('terminal.new'); await flushPromises();
    await app.get('[data-action="select-output-output"]').trigger('click'); data({ id: 's1', data: 'while output hidden' });
    await app.get('[data-action="select-output-terminal"]').trigger('click'); await flushPromises();
    menu('view.togglePanel'); await flushPromises(); data({ id: 's1', data: 'while panel hidden' });
    menu('terminal.toggle'); await flushPromises(); menu('view.toggleSetup'); await flushPromises();
    data({ id: 's1', data: 'while guide open' });
    await app.get('[data-testid="setup-dismiss"]').trigger('click'); await flushPromises();
    expect(app.get('[data-testid="terminal-panel"]').text()).toContain('while output hiddenwhile panel hiddenwhile guide open');
    expect(bridge.create).toHaveBeenCalledOnce(); expect(bridge.close).not.toHaveBeenCalled();
  });

  test('routes terminal shortcuts while leaving shell Ctrl+J and Ctrl+W untouched', async () => {
    const bridge = installDesktop(); const app = await mountApp();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '`', code: 'Backquote', ctrlKey: true, bubbles: true })); await flushPromises();
    const input = app.get('.xterm-helper-textarea').element;
    for (const key of ['j', 'w', 'n', 's', 'b', 'Enter']) {
      const event = new KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true, cancelable: true });
      input.dispatchEvent(event); expect(event.defaultPrevented).toBe(false);
    }
    input.dispatchEvent(new KeyboardEvent('keydown', { key: '~', code: 'Backquote', ctrlKey: true, shiftKey: true, bubbles: true })); await flushPromises();
    expect(bridge.create).toHaveBeenCalledTimes(2);
    menu('terminal.split'); await flushPromises(); expect(app.findAll('[data-testid="terminal-pane"]')).toHaveLength(2);
  });

  test('keeps terminal reachable in a compact desktop window and localizes its controls', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(max-width: 767px)', addEventListener() {}, removeEventListener() {} }));
    installDesktop(); const app = await mountApp(); menu('terminal.new'); await flushPromises();
    expect(app.find('[data-testid="terminal-panel"]').exists()).toBe(true);
    menu('view.toggleSetup'); await flushPromises();
    await app.get('[data-testid="locale-switcher"] [data-locale="zh-CN"]').trigger('click');
    await app.get('[data-testid="setup-dismiss"]').trigger('click'); await flushPromises();
    expect(app.get('[data-action="select-output-terminal"]').text()).toBe('终端');
    expect(app.get('[data-action="terminal-new"]').attributes('aria-label')).toBe('新建终端');
  });

  test('disposes every retained PTY and both event subscriptions when the app unmounts', async () => {
    const bridge = installDesktop(); const app = await mountApp();
    menu('terminal.new'); await flushPromises(); menu('terminal.split'); await flushPromises();
    menu('view.toggleSetup'); await flushPromises(); app.unmount(); wrapper = undefined;
    expect(bridge.close.mock.calls).toEqual([['s1'], ['s2']]);
    expect(bridge.onData.mock.results[0].value).toHaveBeenCalledOnce();
    expect(bridge.onExit.mock.results[0].value).toHaveBeenCalledOnce();
  });

  test('suppresses native menu shortcuts only while a terminal owns keyboard focus', async () => {
    const bridge = installDesktop(); const app = await mountApp();
    menu('terminal.new'); await flushPromises();
    expect(bridge.setFocused).toHaveBeenLastCalledWith(true);
    menu('view.togglePanel'); await flushPromises();
    expect(bridge.setFocused).toHaveBeenLastCalledWith(false);
    menu('terminal.toggle'); await flushPromises();
    expect(bridge.setFocused).toHaveBeenLastCalledWith(true);
    menu('view.toggleSetup'); await flushPromises();
    expect(bridge.setFocused).toHaveBeenLastCalledWith(false);
    await app.get('[data-testid="setup-dismiss"]').trigger('click'); await flushPromises();
    (app.get('.xterm-helper-textarea').element as HTMLElement).focus();
    expect(bridge.setFocused).toHaveBeenLastCalledWith(true);
    (app.get('[data-action="select-output-output"]').element as HTMLElement).focus();
    expect(bridge.setFocused).toHaveBeenLastCalledWith(false);
  });
});
