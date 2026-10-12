import { afterEach, describe, expect, test, vi } from 'vitest';
import { useTerminal } from '../src/composables/useTerminal';
import type { TerminalBridge } from '../src/services/desktopBridge';

const mocks = vi.hoisted(() => ({ terminals: [] as any[], fits: [] as any[] }));
vi.mock('@xterm/xterm', () => ({ Terminal: class {
  cols = 80; rows = 24; options: any = {}; element?: HTMLElement;
  input = (_data: string) => {}; resized = (_size: { cols: number; rows: number }) => {};
  keyHandler: ((event: any) => boolean) | undefined;
  write = vi.fn(); dispose = vi.fn(); focus = vi.fn(); refresh = vi.fn();
  loadAddon = vi.fn();
  attachCustomKeyEventHandler(handler: (event: any) => boolean) { this.keyHandler = handler; }
  constructor(options: any) { this.options = options; mocks.terminals.push(this); }
  open(host: HTMLElement) { this.element = document.createElement('div'); host.append(this.element); }
  onData(handler: any) { this.input = handler; return { dispose: vi.fn() }; }
  onResize(handler: any) { this.resized = handler; return { dispose: vi.fn() }; }
} }));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class {
  fit = vi.fn(); constructor() { mocks.fits.push(this); }
} }));

function fakeBridge() {
  let data = (_event: { id: string; data: string }) => {};
  let exit = (_event: { id: string; exitCode: number }) => {};
  const offData = vi.fn(); const offExit = vi.fn(); let count = 0;
  const bridge = {
    profiles: vi.fn(async () => [{ id: 'pwsh', label: 'PowerShell', family: 'powershell', isDefault: true }, { id: 'cmd', label: 'Command Prompt', family: 'cmd' }]),
    create: vi.fn(async ({ profileId }: { profileId?: string }) => ({ id: `s${++count}`, profileId: profileId ?? 'pwsh', title: profileId ?? 'PowerShell', cwd: 'C:\\workspace' })),
    commands: vi.fn(async (profileId: string) => profileId === 'cmd' ? ['git', 'ls'] : ['pwsh']),
    attach: vi.fn(async (id: string) => { data({ id, data: 'initial prompt> ' }); }),
    write: vi.fn(async () => {}), resize: vi.fn(async () => {}), close: vi.fn(async () => {}),
    setFocused: vi.fn(async (_focused: boolean) => {}),
    onData: vi.fn((handler) => { data = handler; return offData; }),
    onExit: vi.fn((handler) => { exit = handler; return offExit; }),
  } satisfies TerminalBridge;
  return { bridge, offData, offExit, data: (id: string, text: string) => data({ id, data: text }), exit: (id: string, exitCode: number) => exit({ id, exitCode }) };
}

afterEach(() => { mocks.terminals.length = 0; mocks.fits.length = 0; });

describe('app-owned terminal sessions', () => {
  test('discovers actual profiles and installs the buffer before attach replays the prompt', async () => {
    const host = fakeBridge(); const terminal = useTerminal(host.bridge);
    await terminal.loadProfiles(); await terminal.create('cmd');
    expect(terminal.profiles.value.map((profile) => profile.id)).toEqual(['pwsh', 'cmd']);
    expect(host.bridge.create).toHaveBeenCalledWith({ profileId: 'cmd', cols: 80, rows: 24 });
    expect(mocks.terminals[0].write).toHaveBeenCalledWith('initial prompt> ');
    expect(terminal.sessions.value[0]).toMatchObject({ id: 's1', cwd: 'C:\\workspace' });
    expect(host.bridge.attach).toHaveBeenCalledWith('s1');
    await terminal.dispose();
  });

  test('forwards real keyboard bytes including interrupt and fitted resize to the PTY', async () => {
    const host = fakeBridge(); const terminal = useTerminal(host.bridge); await terminal.create();
    mocks.terminals[0].input('echo hello\r'); mocks.terminals[0].input('\x03');
    mocks.terminals[0].resized({ cols: 104, rows: 32 });
    expect(host.bridge.write.mock.calls).toEqual([[{ id: 's1', data: 'echo hello\r' }], [{ id: 's1', data: '\x03' }]]);
    expect(host.bridge.resize).toHaveBeenCalledWith({ id: 's1', cols: 104, rows: 32 });
    await terminal.dispose();
  });

  test('retains buffers and detached xterm elements across panel, setup, output and responsive remounts', async () => {
    const host = fakeBridge(); const terminal = useTerminal(host.bridge); await terminal.create();
    const first = document.createElement('div'); const second = document.createElement('div');
    terminal.mount('s1', first); const element = first.firstElementChild;
    terminal.unmount('s1'); terminal.showOutput(); host.data('s1', 'hidden output');
    terminal.mount('s1', second); terminal.show();
    expect(second.firstElementChild).toBe(element);
    expect(mocks.terminals).toHaveLength(1);
    expect(mocks.terminals[0].write).toHaveBeenCalledWith('hidden output');
    expect(host.bridge.close).not.toHaveBeenCalled();
    await terminal.dispose();
  });

  test('creates split panes, switches sessions, closes only requested shells and cleans app subscriptions', async () => {
    const host = fakeBridge(); const terminal = useTerminal(host.bridge);
    await terminal.create('cmd'); await terminal.split();
    expect(terminal.visibleIds.value).toEqual(['s1', 's2']);
    expect(host.bridge.create.mock.calls[1][0].profileId).toBe('cmd');
    await terminal.create('pwsh'); terminal.select('s1');
    expect(terminal.activeId.value).toBe('s1');
    await terminal.close('s1');
    expect(host.bridge.close).toHaveBeenCalledWith('s1');
    expect(terminal.sessions.value.map((item) => item.id)).toEqual(['s2', 's3']);
    expect(mocks.terminals[0].dispose).toHaveBeenCalledOnce();
    await terminal.dispose();
    expect(host.offData).toHaveBeenCalledOnce(); expect(host.offExit).toHaveBeenCalledOnce();
    expect(host.bridge.close).toHaveBeenCalledTimes(3);
  });

  test('preserves exited output and stops writing to exited processes', async () => {
    const host = fakeBridge(); const terminal = useTerminal(host.bridge); await terminal.create();
    host.exit('s1', 7); mocks.terminals[0].input('ignored');
    expect(terminal.sessions.value[0].exitCode).toBe(7);
    expect(host.bridge.write).not.toHaveBeenCalled();
    expect(mocks.terminals[0].dispose).not.toHaveBeenCalled();
    await terminal.dispose();
  });

  test.each([0, 7])('closes the retained tab after exit %i even when the host no longer owns the session', async (exitCode) => {
    const host = fakeBridge(); const terminal = useTerminal(host.bridge); await terminal.create();
    host.exit('s1', exitCode);
    // The main process removes a naturally exited PTY before forwarding onExit.
    host.bridge.close.mockRejectedValue(new Error('Unknown terminal session'));
    await terminal.close('s1');
    expect(terminal.sessions.value).toEqual([]);
    expect(terminal.visibleIds.value).toEqual([]);
    expect(terminal.activeId.value).toBe('');
    expect(terminal.error.value).toBe('');
    expect(host.bridge.close).not.toHaveBeenCalled();
    expect(mocks.terminals[0].dispose).toHaveBeenCalledOnce();
    await terminal.dispose();
  });

  test('finishes closing a tab when natural exit wins the pending close IPC race', async () => {
    const host = fakeBridge(); const terminal = useTerminal(host.bridge); await terminal.create();
    let rejectClose!: (error: Error) => void;
    host.bridge.close.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { rejectClose = reject; }));
    const closing = terminal.close('s1');
    host.exit('s1', 0);
    rejectClose(new Error('Unknown terminal session'));
    await closing;
    expect(terminal.sessions.value).toEqual([]);
    expect(terminal.error.value).toBe('');
    expect(host.bridge.close).toHaveBeenCalledTimes(1);
    expect(mocks.terminals[0].dispose).toHaveBeenCalledOnce();
    await terminal.dispose();
  });

  test('preserves the live session and reports an actual host close failure', async () => {
    const host = fakeBridge(); const terminal = useTerminal(host.bridge); await terminal.create();
    host.bridge.close.mockRejectedValueOnce(new Error('Close denied'));
    await terminal.close('s1');
    expect(terminal.sessions.value.map((session) => session.id)).toEqual(['s1']);
    expect(terminal.error.value).toBe('Close denied');
    expect(mocks.terminals[0].dispose).not.toHaveBeenCalled();
    await terminal.dispose();
  });

  test('closes a shell created while the app is disposing, without attaching it', async () => {
    const host = fakeBridge(); let resolve!: (value: any) => void;
    host.bridge.create.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const terminal = useTerminal(host.bridge); const pending = terminal.create();
    await terminal.dispose(); resolve({ id: 'late', profileId: 'cmd', title: 'cmd', cwd: 'C:\\' }); await pending;
    expect(host.bridge.close).toHaveBeenCalledWith('late'); expect(host.bridge.attach).not.toHaveBeenCalled();
    expect(terminal.sessions.value).toEqual([]);
  });

  test('cleans failed attaches and exposes failure without leaking the process', async () => {
    const host = fakeBridge(); host.bridge.attach.mockRejectedValueOnce(new Error('attach failed'));
    const terminal = useTerminal(host.bridge); await terminal.create();
    expect(terminal.error.value).toContain('attach failed');
    expect(terminal.sessions.value).toEqual([]); expect(host.bridge.close).toHaveBeenCalledWith('s1');
    await terminal.dispose();
  });

  test('updates existing xterm colors from live theme tokens without replacing the buffer', async () => {
    const host = fakeBridge(); const terminal = useTerminal(host.bridge); await terminal.create();
    document.documentElement.style.setProperty('--surface', '#123456');
    document.documentElement.style.setProperty('--text', '#abcdef');
    terminal.syncTheme();
    expect(mocks.terminals[0].options.theme).toMatchObject({ background: '#123456', foreground: '#abcdef', cursor: '#abcdef' });
    expect(mocks.terminals).toHaveLength(1);
    document.documentElement.style.removeProperty('--surface'); document.documentElement.style.removeProperty('--text');
    await terminal.dispose();
  });

  test('fits attached visible hosts and skips zero-sized or detached panel hosts', async () => {
    const host = fakeBridge(); const terminal = useTerminal(host.bridge); await terminal.create();
    const container = document.createElement('div'); document.body.append(container);
    terminal.mount('s1', container);
    expect(mocks.fits[0].fit).not.toHaveBeenCalled();
    Object.defineProperties(container.firstElementChild!, { clientWidth: { value: 640 }, clientHeight: { value: 320 } });
    terminal.fit('s1'); expect(mocks.fits[0].fit).toHaveBeenCalledOnce();
    terminal.unmount('s1'); terminal.fit('s1'); expect(mocks.fits[0].fit).toHaveBeenCalledOnce();
    container.remove(); await terminal.dispose();
  });

  test('types an injected command into the active shell and refuses a dead or missing session', async () => {
    const host = fakeBridge(); const terminal = useTerminal(host.bridge);
    expect(await terminal.send('python main.py')).toBe(false);
    await terminal.create(); await terminal.create();
    expect(await terminal.send("python 'main.py'")).toBe(true);
    expect(host.bridge.write).toHaveBeenLastCalledWith({ id: 's2', data: "python 'main.py'\r" });
    terminal.select('s1');
    expect(await terminal.send('node main.js')).toBe(true);
    expect(host.bridge.write).toHaveBeenLastCalledWith({ id: 's1', data: 'node main.js\r' });
    // The PTY can exit between the check and the write; the failure surfaces.
    host.bridge.write.mockRejectedValueOnce(new Error('The terminal process has exited.'));
    expect(await terminal.send('racy')).toBe(false);
    expect(terminal.error.value).toContain('exited');
    host.exit('s1', 0);
    expect(await terminal.send('late')).toBe(false);
    expect(await terminal.send('')).toBe(false);
    await terminal.dispose();
    expect(await terminal.send('after dispose')).toBe(false);
  });

  test('fetches the active shell\'s command names once per profile and caches them', async () => {
    const host = fakeBridge(); const terminal = useTerminal(host.bridge);
    await terminal.create('cmd');
    await vi.waitFor(() => expect(host.bridge.commands).toHaveBeenCalledWith('cmd'));
    expect(await terminal.loadCommands('cmd')).toEqual(['git', 'ls']);
    expect(host.bridge.commands).toHaveBeenCalledTimes(1);
    expect(terminal.commandNames.value.cmd).toEqual(['git', 'ls']);
    await terminal.create('pwsh');
    await vi.waitFor(() => expect(host.bridge.commands).toHaveBeenCalledWith('pwsh'));
    expect(terminal.commandNames.value.pwsh).toEqual(['pwsh']);
    expect(terminal.activeProfileId.value).toBe('pwsh');
    await terminal.dispose();
  });

  test('prefetches the default profile\'s commands before any session exists', async () => {
    const host = fakeBridge(); const terminal = useTerminal(host.bridge);
    await terminal.loadProfiles();
    expect(terminal.defaultProfileId.value).toBe('pwsh');
    await vi.waitFor(() => expect(host.bridge.commands).toHaveBeenCalledWith('pwsh'));
    expect(terminal.commandNames.value.pwsh).toEqual(['pwsh']);
    expect(terminal.sessions.value).toEqual([]);
    await terminal.dispose();
  });

  test('retries a shell that answered with an empty command list', async () => {
    const host = fakeBridge();
    host.bridge.commands.mockResolvedValueOnce([]).mockResolvedValueOnce(['git']);
    const terminal = useTerminal(host.bridge);
    await terminal.create();
    await vi.waitFor(() => expect(host.bridge.commands).toHaveBeenCalledTimes(1));
    expect(terminal.commandNames.value.pwsh).toEqual([]);
    // The empty answer is not a result, so the next request asks again.
    expect(await terminal.loadCommands()).toEqual(['git']);
    expect(host.bridge.commands).toHaveBeenCalledTimes(2);
    expect(terminal.commandNames.value.pwsh).toEqual(['git']);
    // A real list is served from the session cache.
    expect(await terminal.loadCommands()).toEqual(['git']);
    expect(host.bridge.commands).toHaveBeenCalledTimes(2);
    await terminal.dispose();
  });

  test('suggests the commands that continue the typed word and types only the rest', async () => {
    const host = fakeBridge(); const terminal = useTerminal(host.bridge);
    await terminal.create('cmd');
    await vi.waitFor(() => expect(terminal.commandNames.value.cmd).toEqual(['git', 'ls']));
    const type = (data: string) => mocks.terminals[0].input(data);
    type('g'); type('i');
    expect(terminal.inputLine.value).toBe('gi');
    expect(terminal.suggestions.value).toEqual(['git']);
    // The shell still receives every keystroke.
    expect(host.bridge.write.mock.calls).toEqual([[{ id: 's1', data: 'g' }], [{ id: 's1', data: 'i' }]]);

    expect(await terminal.complete('git')).toBe(true);
    expect(host.bridge.write).toHaveBeenLastCalledWith({ id: 's1', data: 't' });
    expect(terminal.inputLine.value).toBe('git');
    expect(await terminal.complete('git')).toBe(false, 'a finished word has nothing to type');
    expect(await terminal.complete('ls')).toBe(false, 'a suggestion has to continue the typed word');
    await terminal.dispose();
  });

  test('gives up the input model on anything it cannot follow', async () => {
    const host = fakeBridge(); const terminal = useTerminal(host.bridge);
    await terminal.create('cmd');
    await vi.waitFor(() => expect(terminal.commandNames.value.cmd).toEqual(['git', 'ls']));
    const type = (data: string) => mocks.terminals[0].input(data);

    type('gi');
    type('\x7f');
    expect(terminal.inputLine.value).toBe('g');
    type('it');
    expect(terminal.inputLine.value).toBe('git');
    type('\t');
    expect(terminal.inputLine.value).toBe('git', 'the shell keeps Tab for its own completion');
    type('\r');
    expect(terminal.inputLine.value).toBe('');
    type('gi'); type('\x03');
    expect(terminal.inputLine.value).toBe('');
    type('gi'); type('\x1b[A');
    expect(terminal.inputLine.value).toBe('', 'history navigation is not input the model can follow');
    type('\x1b[C'); type('g');
    expect(terminal.inputLine.value).toBe('g');
    await terminal.dispose();
  });

  test('an argument is not a command name, and switching sessions forgets the line', async () => {
    const host = fakeBridge(); const terminal = useTerminal(host.bridge);
    await terminal.create('cmd');
    await vi.waitFor(() => expect(terminal.commandNames.value.cmd).toEqual(['git', 'ls']));
    mocks.terminals[0].input('git co');
    expect(terminal.inputLine.value).toBe('git co');
    expect(terminal.suggestions.value).toEqual([]);
    await terminal.create('cmd');
    expect(terminal.inputLine.value).toBe('', 'a new session starts on a fresh prompt');
    mocks.terminals[1].input('l');
    expect(terminal.suggestions.value).toEqual(['ls']);
    terminal.select('s1');
    expect(terminal.inputLine.value).toBe('', 'switching panes cannot keep the other shell\'s line');
    await terminal.dispose();
  });

  test('Ctrl+Space accepts the first suggestion and only while one exists', async () => {
    const host = fakeBridge(); const terminal = useTerminal(host.bridge);
    await terminal.create('cmd');
    await vi.waitFor(() => expect(terminal.commandNames.value.cmd).toEqual(['git', 'ls']));
    const handler = mocks.terminals[0].keyHandler!;

    // With nothing typed the key belongs to the shell.
    expect(handler({ ctrlKey: true, altKey: false, code: 'Space', key: ' ' })).toBe(true);
    // The app's own terminal shortcut still wins.
    expect(handler({ ctrlKey: true, altKey: false, code: 'Backquote', key: '`' })).toBe(false);

    mocks.terminals[0].input('gi');
    expect(handler({ ctrlKey: true, altKey: false, code: 'Space', key: ' ' })).toBe(false);
    await vi.waitFor(() => expect(host.bridge.write).toHaveBeenLastCalledWith({ id: 's1', data: 't' }));
    await vi.waitFor(() => expect(terminal.inputLine.value).toBe('git'));
    await terminal.dispose();
  });

  test('a failed command list is reported and retried without breaking the session', async () => {
    const host = fakeBridge();
    host.bridge.commands.mockRejectedValueOnce(new Error('scan failed'));
    const terminal = useTerminal(host.bridge);
    await terminal.create();
    await vi.waitFor(() => expect(terminal.error.value).toContain('scan failed'));
    expect(terminal.commandNames.value).toEqual({});
    expect(await terminal.loadCommands()).toEqual(['pwsh']);
    expect(terminal.commandNames.value.pwsh).toEqual(['pwsh']);
    await terminal.dispose();
  });
});
