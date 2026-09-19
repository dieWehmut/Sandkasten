import { readonly, ref, shallowRef } from 'vue';
import { Terminal, type IDisposable, type ITheme } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import type { TerminalBridge, TerminalProfile, TerminalSession } from '../services/desktopBridge';

export interface TerminalEntry extends TerminalSession { exitCode?: number }

interface SessionView {
  terminal: Terminal;
  fit: FitAddon;
  host: HTMLElement;
  opened: boolean;
  subscriptions: IDisposable[];
}

/** The App owns this controller; panel components only borrow its DOM hosts. */
export function useTerminal(bridge: TerminalBridge) {
  const profiles = shallowRef<TerminalProfile[]>([]);
  const sessions = shallowRef<TerminalEntry[]>([]);
  const activeId = ref('');
  const visibleIds = ref<string[]>([]);
  const shown = ref(false);
  const pending = ref(0);
  const error = ref('');
  const views = new Map<string, SessionView>();
  let disposed = false;
  let focused = false;

  const offData = bridge.onData(({ id, data }) => { views.get(id)?.terminal.write(data); });
  const offExit = bridge.onExit(({ id, exitCode }) => {
    sessions.value = sessions.value.map((session) => session.id === id ? { ...session, exitCode } : session);
    const view = views.get(id);
    if (view) view.terminal.options.disableStdin = true;
  });

  function report(cause: unknown): void {
    if (!disposed) error.value = cause instanceof Error ? cause.message : String(cause);
  }

  function setFocused(next: boolean): void {
    if (disposed || focused === next) return;
    focused = next;
    void bridge.setFocused(next).catch(report);
  }

  function terminalTheme(): ITheme {
    const css = getComputedStyle(document.documentElement);
    const color = (token: string, fallback: string) => css.getPropertyValue(token).trim() || fallback;
    return {
      background: color('--surface', '#1e1e1e'), foreground: color('--text', '#d4d4d4'),
      cursor: color('--text', '#d4d4d4'), cursorAccent: color('--surface', '#1e1e1e'),
      selectionBackground: color('--border-strong', '#535353'),
    };
  }

  function syncTheme(): void {
    for (const view of views.values()) view.terminal.options.theme = terminalTheme();
  }

  async function loadProfiles(): Promise<void> {
    try {
      const discovered = await bridge.profiles();
      if (!disposed) profiles.value = discovered;
    } catch (cause) { report(cause); }
  }

  function removeView(id: string): void {
    const view = views.get(id);
    if (view?.host.contains(document.activeElement)) setFocused(false);
    view?.subscriptions.forEach((subscription) => subscription.dispose());
    view?.terminal.dispose();
    view?.host.remove();
    views.delete(id);
    sessions.value = sessions.value.filter((session) => session.id !== id);
    visibleIds.value = visibleIds.value.filter((visible) => visible !== id);
    if (!visibleIds.value.length && sessions.value.length) visibleIds.value = [sessions.value.at(-1)!.id];
    if (activeId.value === id) activeId.value = visibleIds.value.at(-1) ?? '';
  }

  async function create(profileId?: string, splitFrom?: string): Promise<void> {
    if (disposed) return;
    pending.value += 1;
    error.value = '';
    shown.value = true;
    let session: TerminalSession | undefined;
    try {
      session = await bridge.create({ profileId, cols: 80, rows: 24 });
      if (disposed) { await bridge.close(session.id); return; }
      const id = session.id;
      const terminal = new Terminal({
        cols: 80, rows: 24, cursorBlink: true, fontSize: 13,
        fontFamily: 'Cascadia Code, Consolas, monospace', scrollback: 5000,
        theme: terminalTheme(), allowProposedApi: false, screenReaderMode: true,
      });
      const fit = new FitAddon();
      terminal.loadAddon(fit);
      // Let the App handle its terminal shortcuts; all other input belongs to the shell.
      terminal.attachCustomKeyEventHandler((event) => !isTerminalShortcut(event));
      const host = document.createElement('div');
      host.className = 'terminal-host';
      const subscriptions = [
        terminal.onData((data) => {
          if (sessions.value.find((entry) => entry.id === id)?.exitCode === undefined && views.has(id)) {
            void bridge.write({ id, data }).catch(report);
          }
        }),
        terminal.onResize(({ cols, rows }) => {
          if (sessions.value.find((entry) => entry.id === id)?.exitCode === undefined && views.has(id)) {
            void bridge.resize({ id, cols, rows }).catch(report);
          }
        }),
      ];
      views.set(id, { terminal, fit, host, opened: false, subscriptions });
      sessions.value = [...sessions.value, session];
      visibleIds.value = splitFrom && views.has(splitFrom) ? [splitFrom, id] : [id];
      activeId.value = id;
      // Data/exit subscriptions and the xterm buffer exist before initial replay.
      await bridge.attach(id);
    } catch (cause) {
      if (session && !disposed) {
        removeView(session.id);
        await bridge.close(session.id).catch(() => undefined);
      }
      report(cause);
    } finally { pending.value -= 1; }
  }

  function select(id: string): void {
    if (!views.has(id)) return;
    if (!visibleIds.value.includes(id)) {
      visibleIds.value = visibleIds.value.length === 2
        ? visibleIds.value.map((visible) => visible === activeId.value ? id : visible)
        : [id];
    }
    activeId.value = id;
    shown.value = true;
    views.get(id)?.terminal.focus();
  }

  async function split(): Promise<void> {
    const active = sessions.value.find((session) => session.id === activeId.value);
    await create(active?.profileId, active?.id);
  }

  function fit(id: string): void {
    const view = views.get(id);
    if (!view?.opened || !view.host.isConnected || !view.host.clientWidth || !view.host.clientHeight) return;
    view.fit.fit();
    view.terminal.refresh(0, view.terminal.rows - 1);
  }

  function mount(id: string, container: HTMLElement): void {
    const view = views.get(id);
    if (!view) return;
    container.append(view.host);
    if (!view.opened) { view.terminal.open(view.host); view.opened = true; }
    fit(id);
    if (activeId.value === id && shown.value) view.terminal.focus();
  }

  function unmount(id: string): void {
    const view = views.get(id);
    if (view?.host.contains(document.activeElement)) setFocused(false);
    view?.host.remove();
  }

  async function close(id = activeId.value): Promise<void> {
    if (!views.has(id)) return;
    const exited = () => sessions.value.find((session) => session.id === id)?.exitCode !== undefined;
    // Natural exit removes the PTY in the host, but its output remains here until closed.
    if (exited()) { removeView(id); return; }
    try {
      await bridge.close(id);
      removeView(id);
    } catch (cause) {
      // Exit may also win the race while the close IPC is in flight.
      if (exited()) removeView(id);
      else if (views.has(id)) report(cause);
    }
  }

  async function dispose(): Promise<void> {
    if (disposed) return;
    disposed = true;
    offData(); offExit();
    const ids = [...views.keys()];
    ids.forEach(removeView);
    await Promise.allSettled([bridge.setFocused(false), ...ids.map((id) => bridge.close(id))]);
  }

  return {
    profiles: readonly(profiles), sessions: readonly(sessions), activeId: readonly(activeId),
    visibleIds: readonly(visibleIds), shown: readonly(shown), pending: readonly(pending), error: readonly(error),
    loadProfiles, create, split, select, close, mount, unmount, fit, syncTheme, dispose, setFocused,
    show: () => { shown.value = true; }, showOutput: () => { shown.value = false; },
    focus: () => { views.get(activeId.value)?.terminal.focus(); },
  };
}

export function isTerminalShortcut(event: KeyboardEvent): boolean {
  return (event.ctrlKey || event.metaKey) && !event.altKey
    && (event.code === 'Backquote' || event.key === '`' || event.key === '~');
}

export type TerminalController = ReturnType<typeof useTerminal>;
