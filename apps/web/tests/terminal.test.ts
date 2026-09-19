import { afterEach, describe, expect, test, vi } from 'vitest';
import { useTerminal } from '../src/composables/useTerminal';
import type { TerminalBridge } from '../src/services/desktopBridge';

const mocks = vi.hoisted(() => ({ terminals: [] as any[], fits: [] as any[] }));
vi.mock('@xterm/xterm', () => ({ Terminal: class {
  cols = 80; rows = 24; options: any = {}; element?: HTMLElement;
  input = (_data: string) => {}; resized = (_size: { cols: number; rows: number }) => {};
  write = vi.fn(); dispose = vi.fn(); focus = vi.fn(); refresh = vi.fn();
  loadAddon = vi.fn(); attachCustomKeyEventHandler = vi.fn();
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
    profiles: vi.fn(async () => [{ id: 'pwsh', label: 'PowerShell', isDefault: true }, { id: 'cmd', label: 'Command Prompt' }]),
    create: vi.fn(async ({ profileId }: { profileId?: string }) => ({ id: `s${++count}`, profileId: profileId ?? 'pwsh', title: profileId ?? 'PowerShell', cwd: 'C:\\workspace' })),
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
});
