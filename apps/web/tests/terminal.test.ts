import { afterEach, describe, expect, test, vi } from 'vitest';
import { TERMINAL_FONT_SIZE, TERMINAL_HISTORY_KEY, useTerminal } from '../src/composables/useTerminal';
import type { TerminalBridge, TerminalCommandList } from '../src/services/desktopBridge';

const mocks = vi.hoisted(() => ({ terminals: [] as any[], fits: [] as any[] }));
vi.mock('@xterm/xterm', () => ({ Terminal: class {
  cols = 80; rows = 24; options: any = {}; element?: HTMLElement;
  input = (_data: string) => {}; resized = (_size: { cols: number; rows: number }) => {};
  keyHandler: ((event: any) => boolean) | undefined;
  selection = ''; selected = 0;
  write = vi.fn(); dispose = vi.fn(); focus = vi.fn(); refresh = vi.fn();
  loadAddon = vi.fn();
  getSelection() { return this.selection; }
  selectAll() { this.selected += 1; }
  clearSelection() { this.selection = ''; }
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
    commands: vi.fn(async (profileId: string): Promise<TerminalCommandList> => (profileId === 'cmd'
      ? { names: ['git', 'ls'], shellReported: [] }
      : { names: ['pwsh'], shellReported: [] })),
    attach: vi.fn(async (id: string) => { data({ id, data: 'initial prompt> ' }); }),
    write: vi.fn(async () => {}), resize: vi.fn(async () => {}), close: vi.fn(async () => {}),
    setFocused: vi.fn(async (_focused: boolean) => {}),
    clipboard: { read: vi.fn(async () => 'pasted text'), write: vi.fn(async (_text: string) => true) },
    onData: vi.fn((handler) => { data = handler; return offData; }),
    onExit: vi.fn((handler) => { exit = handler; return offExit; }),
  } satisfies TerminalBridge;
  return { bridge, offData, offExit, data: (id: string, text: string) => data({ id, data: text }), exit: (id: string, exitCode: number) => exit({ id, exitCode }) };
}

const press = (keys: { key: string; ctrlKey?: boolean; shiftKey?: boolean; metaKey?: boolean; altKey?: boolean }) => ({
  key: keys.key, ctrlKey: keys.ctrlKey ?? false, shiftKey: keys.shiftKey ?? false,
  metaKey: keys.metaKey ?? false, altKey: keys.altKey ?? false,
  preventDefault: () => {}, stopPropagation: () => {},
});

afterEach(() => { mocks.terminals.length = 0; mocks.fits.length = 0; window.localStorage.clear(); });

test('a browser preview without a clipboard bridge pastes nothing instead of failing', async () => {
  // The WebUI runs in a plain browser too, where the desktop bridge is absent: the
  // keys stay ours, and nothing is sent to a shell that is not there.
  const host = fakeBridge();
  delete (host.bridge as { clipboard?: unknown }).clipboard;
  const terminal = useTerminal(host.bridge); await terminal.create();
  expect(mocks.terminals[0].keyHandler(press({ key: 'v', ctrlKey: true, shiftKey: true }))).toBe(false);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(host.bridge.write).not.toHaveBeenCalled();
  await terminal.dispose();
});

test('zoom steps the terminal font, within bounds, across sessions', async () => {
  const host = fakeBridge(); const terminal = useTerminal(host.bridge); await terminal.create();
  const xterm = mocks.terminals[0];
  expect(terminal.fontSize.value).toBe(13);
  expect(xterm.options.fontSize).toBe(13);

  // Ctrl+= and Ctrl+- are the terminal's; Ctrl+A without Shift is still the shell's.
  expect(xterm.keyHandler(press({ key: '=', ctrlKey: true }))).toBe(false);
  expect(terminal.fontSize.value).toBe(14);
  expect(xterm.options.fontSize).toBe(14);
  xterm.keyHandler(press({ key: '-', ctrlKey: true }));
  expect(terminal.fontSize.value).toBe(13);
  expect(xterm.keyHandler(press({ key: 'a', ctrlKey: true }))).toBe(true);

  // The bounds are bounds: zooming past them changes nothing.
  for (let step = 0; step < 30; step += 1) terminal.zoom(1);
  expect(terminal.fontSize.value).toBe(32);
  for (let step = 0; step < 40; step += 1) terminal.zoom(-1);
  expect(terminal.fontSize.value).toBe(8);
  terminal.zoom(TERMINAL_FONT_SIZE.default - terminal.fontSize.value);
  expect(terminal.fontSize.value).toBe(13);
  expect(xterm.options.fontSize).toBe(13);

  // Every session takes the size, not only the one in front.
  await terminal.split();
  terminal.zoom(1);
  terminal.zoom(1);
  expect(mocks.terminals.map((view) => view.options.fontSize)).toEqual([15, 15]);
  await terminal.dispose();
});

describe('app-owned terminal sessions', () => {
  test('copy and paste are the host clipboard, while Ctrl+C stays with the shell', async () => {
    const host = fakeBridge(); const terminal = useTerminal(host.bridge); await terminal.create();
    const xterm = mocks.terminals[0];
    // Ctrl+C and Ctrl+V belong to the shell: a terminal that swallowed them could
    // never interrupt a program or send a literal control character.
    expect(xterm.keyHandler(press({ key: 'c', ctrlKey: true }))).toBe(true);
    expect(xterm.keyHandler(press({ key: 'v', ctrlKey: true }))).toBe(true);
    expect(xterm.keyHandler(press({ key: 'a', ctrlKey: true }))).toBe(true);
    expect(host.bridge.clipboard!.write).not.toHaveBeenCalled();

    // Copy takes the selection and only the selection.
    expect(xterm.keyHandler(press({ key: 'c', ctrlKey: true, shiftKey: true }))).toBe(false);
    xterm.selection = 'picked up text';
    xterm.keyHandler(press({ key: 'c', ctrlKey: true, shiftKey: true }));
    await vi.waitFor(() => expect(host.bridge.clipboard!.write).toHaveBeenCalledWith('picked up text'));
    // The macOS spelling is Command+C, without Shift.
    xterm.selection = 'again';
    xterm.keyHandler(press({ key: 'c', metaKey: true }));
    await vi.waitFor(() => expect(host.bridge.clipboard!.write).toHaveBeenCalledWith('again'));

    // Paste sends the clipboard to the PTY as input.
    expect(xterm.keyHandler(press({ key: 'v', ctrlKey: true, shiftKey: true }))).toBe(false);
    await vi.waitFor(() => expect(host.bridge.write).toHaveBeenCalledWith({ id: 's1', data: 'pasted text' }));

    // Select all is ours too, and it is not typed into the shell.
    expect(xterm.keyHandler(press({ key: 'a', ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(xterm.selected).toBe(1);

    // Shift+Insert is the older Windows spelling of paste, and plain Insert is not.
    expect(xterm.keyHandler(press({ key: 'Insert', shiftKey: true }))).toBe(false);
    await vi.waitFor(() => expect(host.bridge.write).toHaveBeenCalledWith({ id: 's1', data: 'pasted text' }));
    expect(xterm.keyHandler(press({ key: 'Insert' }))).toBe(true);

    // A middle-click pastes the primary selection, which is a different buffer.
    await terminal.clipboard('paste-selection');
    expect(host.bridge.clipboard!.read).toHaveBeenLastCalledWith('selection');
    await vi.waitFor(() => expect(host.bridge.write).toHaveBeenCalledTimes(3));
    await terminal.clipboard('paste');
    expect(host.bridge.clipboard!.read).toHaveBeenLastCalledWith('clipboard');
    await terminal.dispose();
  });

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
    host.bridge.commands
      .mockResolvedValueOnce({ names: [], shellReported: [] })
      .mockResolvedValueOnce({ names: ['git'], shellReported: [] });
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
    expect(terminal.suggestions.value).toEqual([{ label: 'git', value: 'git' }]);
    // The shell still receives every keystroke.
    expect(host.bridge.write.mock.calls).toEqual([[{ id: 's1', data: 'g' }], [{ id: 's1', data: 'i' }]]);

    expect(await terminal.complete({ label: 'git', value: 'git' })).toBe(true);
    expect(host.bridge.write).toHaveBeenLastCalledWith({ id: 's1', data: 't' });
    expect(terminal.inputLine.value).toBe('git');
    expect(await terminal.complete({ label: 'git', value: 'git' }), 'a finished word has nothing to type').toBe(false);
    expect(await terminal.complete({ label: 'ls', value: 'ls' }), 'a suggestion has to continue the typed word').toBe(false);
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
    expect(terminal.inputLine.value, 'the shell keeps Tab for its own completion').toBe('git');
    type('\r');
    expect(terminal.inputLine.value).toBe('');
    type('gi'); type('\x03');
    expect(terminal.inputLine.value).toBe('');
    type('gi'); type('\x1b[A');
    expect(terminal.inputLine.value, 'history navigation is not input the model can follow').toBe('');
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
    expect(terminal.inputLine.value, 'a new session starts on a fresh prompt').toBe('');
    mocks.terminals[1].input('l');
    expect(terminal.suggestions.value).toEqual([{ label: 'ls', value: 'ls' }]);
    terminal.select('s1');
    expect(terminal.inputLine.value, "switching panes cannot keep the other shell's line").toBe('');
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

  test('completes a file argument from the workspace and quotes it when needed', async () => {
    const host = fakeBridge();
    const terminal = useTerminal(host.bridge, { paths: () => ['main.py', 'my notes.txt', 'scripts/', 'scripts/task.py'] });
    await terminal.loadProfiles();
    await terminal.create('cmd');
    await vi.waitFor(() => expect(terminal.commandNames.value.cmd).toEqual(['git', 'ls']));
    const type = (data: string) => mocks.terminals[0].input(data);

    type('python mai');
    expect(terminal.suggestions.value).toEqual([{ label: 'main.py', value: 'main.py' }]);
    expect(await terminal.complete({ label: 'main.py', value: 'main.py' })).toBe(true);
    expect(host.bridge.write).toHaveBeenLastCalledWith({ id: 's1', data: 'n.py' });
    expect(terminal.inputLine.value).toBe('python main.py');

    // A path with a space cannot be a continuation of what was typed: the token
    // is replaced, and the shell's own quoting is used for its family.
    type('\x03'); type('type my');
    expect(terminal.suggestions.value).toEqual([{ label: 'my notes.txt', value: 'my notes.txt' }]);
    expect(await terminal.complete({ label: 'my notes.txt', value: 'my notes.txt' })).toBe(true);
    expect(host.bridge.write).toHaveBeenLastCalledWith({ id: 's1', data: `\x7f\x7f"my notes.txt"` });
    expect(terminal.inputLine.value).toBe('type "my notes.txt"');

    // An argument that matches nothing offers nothing.
    type('\x03'); type('python zzz');
    expect(terminal.suggestions.value).toEqual([]);

    // A folder arrives with its separator, so the next segment can be typed.
    type('\x03'); type('cd scr');
    expect(terminal.suggestions.value).toEqual([
      { label: 'scripts/', value: 'scripts/' },
      { label: 'scripts/task.py', value: 'scripts/task.py' },
    ]);
    expect(await terminal.complete({ label: 'scripts/', value: 'scripts/' })).toBe(true);
    expect(host.bridge.write).toHaveBeenLastCalledWith({ id: 's1', data: 'ipts/' });
    expect(terminal.inputLine.value).toBe('cd scripts/');

    // A nested file completes through the folder that contains it.
    type('\x03'); type('cd scripts/task');
    expect(terminal.suggestions.value).toEqual([{ label: 'scripts/task.py', value: 'scripts/task.py' }]);
    expect(await terminal.complete({ label: 'scripts/task.py', value: 'scripts/task.py' })).toBe(true);
    expect(host.bridge.write).toHaveBeenLastCalledWith({ id: 's1', data: '.py' });
    expect(terminal.inputLine.value).toBe('cd scripts/task.py');
    await terminal.dispose();
  });

  test('the suggestions already accepted this session lead the strip', async () => {
    const host = fakeBridge();
    host.bridge.commands.mockResolvedValue({ names: ['git', 'git-lfs', 'gitui'], shellReported: [] });
    const terminal = useTerminal(host.bridge);
    await terminal.create('cmd');
    await vi.waitFor(() => expect(terminal.commandNames.value.cmd).toEqual(['git', 'git-lfs', 'gitui']));
    const type = (data: string) => mocks.terminals[0].input(data);

    type('gi');
    expect(terminal.suggestions.value.map((suggestion) => suggestion.value)).toEqual(['git', 'git-lfs', 'gitui']);
    expect(await terminal.complete({ label: 'gitui', value: 'gitui' })).toBe(true);

    type('\r'); type('gi');
    expect(terminal.suggestions.value.map((suggestion) => suggestion.value)).toEqual(['gitui', 'git', 'git-lfs']);
    await terminal.dispose();
  });

  test('completion follows the folder the shell moved into', async () => {
    const host = fakeBridge();
    const terminal = useTerminal(host.bridge, { paths: () => ['main.py', 'scripts/', 'scripts/task.py'] });
    await terminal.create('cmd');
    await vi.waitFor(() => expect(terminal.commandNames.value.cmd).toEqual(['git', 'ls']));
    const type = (data: string) => mocks.terminals[0].input(data);

    // At the workspace root the whole path completes.
    type('cd scr');
    expect(terminal.suggestions.value.map((suggestion) => suggestion.value)).toEqual(['scripts/', 'scripts/task.py']);

    // Moving in with a real command is followed. The incomplete `cd scr` above was
    // discarded, so it never moved the shell.
    type('\x03'); type('cd scripts'); type('\r');

    // After moving in, the names inside the folder complete instead, and the
    // path that gets typed is relative to where the shell now is.
    type('cd ta');
    expect(terminal.suggestions.value).toEqual([{ label: 'task.py', value: 'task.py' }]);
    expect(await terminal.complete({ label: 'task.py', value: 'task.py' })).toBe(true);
    expect(host.bridge.write).toHaveBeenLastCalledWith({ id: 's1', data: 'sk.py' });
    expect(terminal.inputLine.value).toBe('cd task.py');

    // `cd ..` goes back, so the workspace paths match again.
    type('\x03'); type('cd ..'); type('\r'); type('python mai');
    expect(terminal.suggestions.value.map((suggestion) => suggestion.value)).toEqual(['main.py']);

    // A directory this model cannot follow leaves it where it was rather than
    // inventing one.
    type('\x03'); type('cd $HOME'); type('\r'); type('python mai');
    expect(terminal.suggestions.value.map((suggestion) => suggestion.value)).toEqual(['main.py']);
    await terminal.dispose();
  });

  test('the directory stack and the shell synonyms are followed too', async () => {
    const host = fakeBridge();
    const terminal = useTerminal(host.bridge, {
      paths: () => ['main.py', 'my folder/', 'my folder/deep.txt', 'scripts/', 'scripts/task.py'],
    });
    await terminal.create('cmd');
    await vi.waitFor(() => expect(terminal.commandNames.value.cmd).toEqual(['git', 'ls']));
    const type = (data: string) => mocks.terminals[0].input(data);
    const run = (line: string) => { type(line); type('\r'); };

    // `pushd` moves, and `popd` sends it back to where it was.
    run('pushd scripts');
    type('cd ta');
    expect(terminal.suggestions.value.map((suggestion) => suggestion.value)).toEqual(['task.py']);
    type('\x03'); run('popd');
    type('python mai');
    expect(terminal.suggestions.value.map((suggestion) => suggestion.value)).toEqual(['main.py']);

    // A quoted path is one argument, spaces and all.
    type('\x03'); run('cd "my folder"');
    type('python de');
    expect(terminal.suggestions.value.map((suggestion) => suggestion.value)).toEqual(['deep.txt']);

    // The PowerShell and cmd spellings work as well.
    type('\x03'); run('Set-Location ../scripts');
    type('python ta');
    expect(terminal.suggestions.value.map((suggestion) => suggestion.value)).toEqual(['task.py']);
    type('\x03'); run('chdir ..');
    type('python mai');
    expect(terminal.suggestions.value.map((suggestion) => suggestion.value)).toEqual(['main.py']);

    // `popd` with nothing pushed leaves the shell where it is.
    type('\x03'); run('popd');
    type('python mai');
    expect(terminal.suggestions.value.map((suggestion) => suggestion.value)).toEqual(['main.py']);

    // Nothing the shell would expand is followed: the strip stays usable.
    type('\x03'); run('cd $HOME');
    type('python mai');
    expect(terminal.suggestions.value.map((suggestion) => suggestion.value)).toEqual(['main.py']);
    await terminal.dispose();
  });

  test('a PowerShell cmdlet is not starved by the PATH executables', async () => {
    const host = fakeBridge();
    host.bridge.commands.mockResolvedValue({
      names: ['git', 'go', 'Get-ChildItem', 'Get-Content', 'Get-Help'],
      shellReported: ['Get-ChildItem', 'Get-Content', 'Get-Help'],
    });
    const terminal = useTerminal(host.bridge);
    await terminal.create('cmd');
    await vi.waitFor(() => expect(terminal.commandNames.value.cmd).toHaveLength(5));
    const type = (data: string) => mocks.terminals[0].input(data);

    // Both kinds take turns, so the five entries the strip holds cover both.
    type('g');
    expect(terminal.suggestions.value.map((suggestion) => suggestion.value))
      .toEqual(['git', 'Get-ChildItem', 'go', 'Get-Content', 'Get-Help']);
    // The strip can say which kind each entry is: a cmdlet has no file behind it.
    expect(terminal.suggestions.value.map((suggestion) => suggestion.source))
      .toEqual([undefined, 'shell', undefined, 'shell', 'shell']);

    // A cmdlet's own prefix still leads, and accepting it marks it as used.
    type('\x03'); type('get-c');
    expect(terminal.suggestions.value.map((suggestion) => suggestion.value)).toEqual(['Get-ChildItem', 'Get-Content']);
    expect(await terminal.complete({ label: 'Get-Content', value: 'Get-Content' })).toBe(true);
    type('\x03'); type('get-c');
    expect(terminal.suggestions.value.map((suggestion) => suggestion.value)).toEqual(['Get-Content', 'Get-ChildItem']);
    await terminal.dispose();
  });

  test('`cd -` goes back only where the shell really means it', async () => {
    const host = fakeBridge();
    host.bridge.profiles.mockResolvedValue([
      { id: 'git-bash', label: 'Git Bash', family: 'bash', isDefault: true },
      { id: 'cmd', label: 'Command Prompt', family: 'cmd' },
    ]);
    const terminal = useTerminal(host.bridge, { paths: () => ['main.py', 'scripts/', 'scripts/task.py'] });
    await terminal.loadProfiles();
    await terminal.create('git-bash');
    await vi.waitFor(() => expect(terminal.commandNames.value['git-bash']).toEqual(['pwsh']));
    const type = (data: string) => mocks.terminals[0].input(data);
    const run = (line: string) => { type(line); type('\r'); };

    run('cd scripts');
    type('python ta');
    expect(terminal.suggestions.value.map((suggestion) => suggestion.value)).toEqual(['task.py']);

    // The POSIX shells know `cd -` as the directory they came from.
    type('\x03'); run('cd -');
    type('python mai');
    expect(terminal.suggestions.value.map((suggestion) => suggestion.value)).toEqual(['main.py']);
    type('\x03'); await terminal.close('s1');

    // cmd does not, so following it would put the completions somewhere the shell
    // never went.
    await terminal.create('cmd');
    const second = (data: string) => mocks.terminals[1].input(data);
    const run2 = (line: string) => { second(line); second('\r'); };
    run2('cd scripts');
    second('\x03'); run2('cd -');
    second('python ta');
    expect(terminal.suggestions.value.map((suggestion) => suggestion.value)).toEqual(['task.py']);
    await terminal.dispose();
  });

  test('the accepted suggestions survive a restart', async () => {
    const host = fakeBridge();
    host.bridge.commands.mockResolvedValue({ names: ['git', 'git-lfs', 'gitui'], shellReported: [] });
    const terminal = useTerminal(host.bridge);
    await terminal.create('cmd');
    await vi.waitFor(() => expect(terminal.commandNames.value.cmd).toEqual(['git', 'git-lfs', 'gitui']));
    mocks.terminals[0].input('gi');
    await terminal.complete({ label: 'gitui', value: 'gitui' });
    await terminal.dispose();
    expect(JSON.parse(window.localStorage.getItem(TERMINAL_HISTORY_KEY) ?? '[]')).toEqual(['gitui']);

    // A fresh controller is what the next start looks like.
    const restarted = fakeBridge();
    restarted.bridge.commands.mockResolvedValue({ names: ['git', 'git-lfs', 'gitui'], shellReported: [] });
    const next = useTerminal(restarted.bridge);
    await next.create('cmd');
    await vi.waitFor(() => expect(next.commandNames.value.cmd).toEqual(['git', 'git-lfs', 'gitui']));
    mocks.terminals[1].input('gi');
    expect(next.suggestions.value.map((suggestion) => suggestion.value)).toEqual(['gitui', 'git', 'git-lfs']);
    await next.dispose();
  });

  test('a broken or unavailable history store cannot break the terminal', async () => {
    window.localStorage.setItem(TERMINAL_HISTORY_KEY, '{ not json at all');
    const host = fakeBridge();
    const terminal = useTerminal(host.bridge);
    await terminal.create('cmd');
    await vi.waitFor(() => expect(terminal.commandNames.value.cmd).toEqual(['git', 'ls']));
    mocks.terminals[0].input('gi');
    expect(terminal.suggestions.value.map((suggestion) => suggestion.value)).toEqual(['git']);
    await terminal.dispose();

    const denied = {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('denied'); },
    } as unknown as Storage;
    const blocked = fakeBridge();
    const noStorage = useTerminal(blocked.bridge, { history: denied });
    await noStorage.create('cmd');
    await vi.waitFor(() => expect(noStorage.commandNames.value.cmd).toEqual(['git', 'ls']));
    mocks.terminals[1].input('gi');
    expect(await noStorage.complete({ label: 'git', value: 'git' })).toBe(true);
    await noStorage.dispose();
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
