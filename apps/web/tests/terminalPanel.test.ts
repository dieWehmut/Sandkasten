import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import App from '../src/App.vue';
import { SETUP_WELCOME_STORAGE_KEY } from '../src/composables/useSetupWelcome';
import type { DesktopBridge, TerminalBridge, WorkspaceRoot, WorkspaceTreeNode } from '../src/services/desktopBridge';

vi.mock('../src/services/sandkastenApi', async (original) => ({
  ...await original<typeof import('../src/services/sandkastenApi')>(), loadRuntimes: vi.fn(async () => []),
}));
const xterm = vi.hoisted(() => ({ terminals: [] as any[] }));
vi.mock('@xterm/xterm', () => ({ Terminal: class {
  cols = 80; rows = 24; options: any; host?: HTMLElement; text = ''; input: (data: string) => void = () => {};
  constructor(options: any) { this.options = options; xterm.terminals.push(this); }
  open(host: HTMLElement) { this.host = host; host.innerHTML = '<textarea class="xterm-helper-textarea"></textarea><span></span>'; this.write(''); }
  write(data: string) { this.text += data; if (this.host) this.host.querySelector('span')!.textContent = this.text; }
  loadAddon() {} attachCustomKeyEventHandler() {} dispose() {} refresh() {}
  focus() { this.host?.querySelector('textarea')?.focus(); }
  onData(handler: any) { this.input = handler; return { dispose() {} }; } onResize() { return { dispose() {} }; }
} }));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit() {} } }));

let wrapper: ReturnType<typeof mount> | undefined;
let menu: (command: string) => void;
let data: (event: { id: string; data: string }) => void;
function installDesktop(options: { root?: WorkspaceRoot | null; files?: WorkspaceTreeNode[]; source?: string; shellReported?: string[] } = {}) {
  let index = 0;
  const terminal = {
    profiles: vi.fn(async () => [{ id: 'pwsh', label: 'PowerShell', family: 'powershell', isDefault: true }, { id: 'cmd', label: 'Command Prompt', family: 'cmd' }]),
    create: vi.fn(async ({ profileId }: { profileId?: string }) => ({ id: `s${++index}`, profileId: profileId ?? 'pwsh', title: profileId ?? 'PowerShell', cwd: 'C:\\workspace' })),
    commands: vi.fn(async (profileId: string) => (profileId === 'cmd'
      ? { names: ['git', 'ls'], shellReported: [] }
      : { names: ['python', 'git', ...(options.shellReported ?? [])], shellReported: options.shellReported ?? [] })),
    attach: vi.fn(async (id: string) => { data({ id, data: 'prompt> ' }); }),
    write: vi.fn(async () => {}), resize: vi.fn(async () => {}), close: vi.fn(async () => {}),
    setFocused: vi.fn(async (_focused: boolean) => {}),
    onData: vi.fn((handler) => { data = handler; return vi.fn(); }), onExit: vi.fn(() => vi.fn()),
  } satisfies TerminalBridge;
  const bridge: DesktopBridge = {
    platform: 'win32', versions: {}, terminal,
    workspace: { root: vi.fn(async () => options.root ?? null), list: vi.fn(async () => options.files ?? []), openFolder: vi.fn(async () => null), read: vi.fn(async () => options.source ?? 'print("hello")\n'), write: vi.fn(), create: vi.fn(), remove: vi.fn() },
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
beforeEach(() => { window.localStorage.clear(); window.localStorage.setItem(SETUP_WELCOME_STORAGE_KEY, 'true'); xterm.terminals.length = 0; });
afterEach(() => { wrapper?.unmount(); wrapper = undefined; delete (window as any).sandkastenDesktop; xterm.terminals.length = 0; vi.unstubAllGlobals(); });

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

  test('runs the active file in the active shell with that shell\'s quoting', async () => {
    const bridge = installDesktop({
      root: { path: 'C:\\workspace', name: 'workspace' },
      files: [{ path: 'main.py', name: 'main.py', type: 'file' }],
    });
    const app = await mountApp();
    expect(app.get('[data-testid="window-title"]').text()).toContain('main.py');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'P', ctrlKey: true, shiftKey: true }));
    await flushPromises();
    expect(app.find('[data-command="terminal.runFile"]').exists()).toBe(true);
    await app.get('[data-command="terminal.runFile"]').trigger('click');
    // The command opens the panel, starts the default shell and only then types.
    await vi.waitFor(() => expect(bridge.write).toHaveBeenCalledWith({ id: 's1', data: "python 'main.py'\r" }));
    expect(bridge.create).toHaveBeenCalledWith({ profileId: undefined, cols: 80, rows: 24 });
    expect(app.find('[data-testid="terminal-panel"]').exists()).toBe(true);
  });

  test('offers the active shell\'s commands in the palette and types the chosen one', async () => {
    const bridge = installDesktop();
    const app = await mountApp();
    menu('terminal.new');
    await flushPromises();
    // Hiding the panel must not turn a palette command into a silent write: the
    // session it types into has to become visible.
    menu('view.togglePanel');
    await flushPromises();
    expect(app.find('[data-testid="terminal-panel"]').exists()).toBe(false);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'P', ctrlKey: true, shiftKey: true }));
    await flushPromises();
    const git = app.find('[data-command="shell.git"]');
    expect(git.exists()).toBe(true);
    expect(git.text()).toContain('git');
    expect(git.text()).toContain('PowerShell');
    await git.trigger('click');
    await vi.waitFor(() => expect(bridge.write).toHaveBeenCalledWith({ id: 's1', data: 'git\r' }));
    expect(bridge.commands).toHaveBeenCalledWith('pwsh');
    expect(app.find('[data-testid="terminal-panel"]').exists()).toBe(true);

    // The command that just ran leads the shell section the next time.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'P', ctrlKey: true, shiftKey: true }));
    await flushPromises();
    const shellRows = app.findAll('[data-command^="shell."]');
    expect(shellRows.length).toBeGreaterThan(1);
    expect(shellRows[0].attributes('data-command')).toBe('shell.git');
  });

  test('reports a shell command the session refuses instead of failing silently', async () => {
    const bridge = installDesktop();
    const app = await mountApp();
    menu('terminal.new');
    await flushPromises();
    // The PTY can exit between the palette click and the write.
    bridge.write.mockRejectedValueOnce(new Error('The terminal process has exited.'));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'P', ctrlKey: true, shiftKey: true }));
    await flushPromises();
    await app.get('[data-command="shell.git"]').trigger('click');
    await vi.waitFor(() => expect(app.findAll('[data-testid="notification-toast"]').length).toBe(1));
  });

  test('offers the default shell\'s commands before the terminal is ever opened', async () => {
    const bridge = installDesktop();
    const app = await mountApp();
    expect(app.find('[data-testid="terminal-panel"]').exists()).toBe(false);
    expect(bridge.create).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(bridge.commands).toHaveBeenCalledWith('pwsh'));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'P', ctrlKey: true, shiftKey: true }));
    await flushPromises();
    const git = app.find('[data-command="shell.git"]');
    expect(git.exists()).toBe(true);
    // Choosing one starts the default shell and types the command into it.
    await git.trigger('click');
    await vi.waitFor(() => expect(bridge.create).toHaveBeenCalledWith({ profileId: undefined, cols: 80, rows: 24 }));
    await vi.waitFor(() => expect(bridge.write).toHaveBeenCalledWith({ id: 's1', data: 'git\r' }));
  });

  test('opening the palette retries a shell that answered with an empty list', async () => {
    const bridge = installDesktop();
    bridge.commands.mockResolvedValueOnce([]);
    const app = await mountApp();
    await vi.waitFor(() => expect(bridge.commands).toHaveBeenCalledTimes(1));
    expect(app.findAll('[data-command^="shell."]').length).toBe(0);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'P', ctrlKey: true, shiftKey: true }));
    await flushPromises();
    await vi.waitFor(() => expect(bridge.commands).toHaveBeenCalledTimes(2));
    await flushPromises();
    expect(app.find('[data-command="shell.git"]').exists()).toBe(true);
  });

  test('suggests the shell commands while typing and types only the rest of the chosen one', async () => {
    const bridge = installDesktop();
    const app = await mountApp();
    menu('terminal.new');
    await flushPromises();
    await vi.waitFor(() => expect(bridge.commands).toHaveBeenCalledWith('pwsh'));
    xterm.terminals.at(-1).input('py');
    await flushPromises();
    const suggestion = app.find('[data-testid="terminal-suggestion"][data-command="python"]');
    expect(suggestion.exists()).toBe(true);
    // Nothing is suggested before the user types.
    await suggestion.trigger('click');
    await vi.waitFor(() => expect(bridge.write).toHaveBeenCalledWith({ id: 's1', data: 'thon' }));
    expect(xterm.terminals.at(-1).input).toBeTypeOf('function');
  });

  test('completes a workspace file as a command argument', async () => {
    const bridge = installDesktop({
      root: { path: 'C:\\workspace', name: 'workspace' },
      files: [{ path: 'main.py', name: 'main.py', type: 'file' }],
    });
    const app = await mountApp();
    menu('terminal.new');
    await flushPromises();
    xterm.terminals.at(-1).input('python mai');
    await flushPromises();
    const suggestion = app.find('[data-testid="terminal-suggestion"][data-command="main.py"]');
    expect(suggestion.exists()).toBe(true);
    await suggestion.trigger('click');
    await vi.waitFor(() => expect(bridge.write).toHaveBeenCalledWith({ id: 's1', data: 'n.py' }));
  });

  test('completes a workspace folder as a directory argument', async () => {
    const bridge = installDesktop({
      root: { path: 'C:\\workspace', name: 'workspace' },
      files: [
        { path: 'scripts', name: 'scripts', type: 'directory', children: [{ path: 'scripts/task.py', name: 'task.py', type: 'file' }] },
      ],
    });
    const app = await mountApp();
    menu('terminal.new');
    await flushPromises();
    xterm.terminals.at(-1).input('cd scr');
    await flushPromises();
    const suggestion = app.find('[data-testid="terminal-suggestion"][data-command="scripts/"]');
    expect(suggestion.exists()).toBe(true);
    await suggestion.trigger('click');
    await vi.waitFor(() => expect(bridge.write).toHaveBeenCalledWith({ id: 's1', data: 'ipts/' }));

    // Running that command moves the shell into the folder, so what completes next
// is the name inside it rather than a path from the workspace root.
    xterm.terminals.at(-1).input('\r');
    xterm.terminals.at(-1).input('python ta');
    await flushPromises();
    const nested = app.find('[data-testid="terminal-suggestion"][data-command="task.py"]');
    expect(nested.exists()).toBe(true);
    await nested.trigger('click');
    await vi.waitFor(() => expect(bridge.write).toHaveBeenCalledWith({ id: 's1', data: 'sk.py' }));
  });

  test('a command accepted in the terminal leads the palette after a restart', async () => {
    // What the terminal accepted in an earlier session is in the history store.
    window.localStorage.setItem('sandkasten-terminal-history-v1', JSON.stringify(['git']));
    installDesktop();
    const app = await mountApp();
    await vi.waitFor(() => expect(app.find('[data-testid="terminal-panel"]').exists()).toBe(false));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'P', ctrlKey: true, shiftKey: true }));
    await flushPromises();
    const shellRows = app.findAll('[data-command^="shell."]');
    expect(shellRows.length).toBeGreaterThan(1);
    expect(shellRows[0].attributes('data-command')).toBe('shell.git');
  });

  test('the palette says which commands the shell reports about itself', async () => {
    installDesktop({ shellReported: ['Get-ChildItem'] });
    const app = await mountApp();
    await vi.waitFor(() => expect(app.find('[data-testid="terminal-panel"]').exists()).toBe(false));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'P', ctrlKey: true, shiftKey: true }));
    await flushPromises();

    const cmdlet = app.find('[data-command="shell.Get-ChildItem"]');
    expect(cmdlet.exists()).toBe(true);
    expect(cmdlet.text()).toContain('cmdlet, function or alias');
    // An executable on the PATH keeps the plain profile label.
    expect(app.get('[data-command="shell.python"]').text()).not.toContain('cmdlet');
  });

  test('the suggestion strip marks the commands the shell reports about itself', async () => {
    const bridge = installDesktop({ shellReported: ['Get-ChildItem'] });
    const app = await mountApp();
    menu('terminal.new');
    await flushPromises();
    await vi.waitFor(() => expect(bridge.commands).toHaveBeenCalledWith('pwsh'));
    xterm.terminals.at(-1).input('get-ch');
    await flushPromises();

    const shellSuggestion = app.find('[data-testid="terminal-suggestion"][data-command="Get-ChildItem"]');
    expect(shellSuggestion.exists()).toBe(true);
    expect(shellSuggestion.attributes('data-source')).toBe('shell');
    expect(shellSuggestion.attributes('title')).toContain('cmdlet, function or alias');
    expect(shellSuggestion.classes()).toContain('terminal-suggestions__item--shell');

    // An executable is offered without a marker.
    xterm.terminals.at(-1).input('\x03');
    xterm.terminals.at(-1).input('py');
    await flushPromises();
    const executable = app.find('[data-testid="terminal-suggestion"][data-command="python"]');
    expect(executable.exists()).toBe(true);
    expect(executable.attributes('data-source')).toBeUndefined();
    expect(executable.attributes('title')).not.toContain('shell builtin');
  });
});
