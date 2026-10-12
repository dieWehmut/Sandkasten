import { computed, readonly, ref, shallowRef, watch } from 'vue';
import { Terminal, type IDisposable, type ITheme } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import type { TerminalBridge, TerminalProfile, TerminalSession } from '../services/desktopBridge';
import { quoteForShell } from '../terminal/terminalCommand';

export interface TerminalEntry extends TerminalSession { exitCode?: number }

/** What the suggestion strip offers: a label to show and the word it completes to. */
export interface TerminalSuggestion {
  label: string;
  value: string;
  /**
   * Set when the shell reports this command about itself — a cmdlet or a builtin
   * has no file behind it — so the strip can say which kind it is offering.
   */
  source?: 'shell';
}

interface SessionView {
  terminal: Terminal;
  fit: FitAddon;
  host: HTMLElement;
  opened: boolean;
  subscriptions: IDisposable[];
}

export interface TerminalOptions {
  /**
   * Workspace paths offered as arguments once the command word is typed. A
   * directory is expected to carry a trailing separator.
   */
  paths?: () => readonly string[];
  /** Where the accepted-suggestion history lives; defaults to localStorage. */
  history?: Storage;
}

// What the user accepted in earlier sessions. It is a convenience cache, so
// every read and write is guarded: private mode and a half-written entry must
// not break the terminal.
export const TERMINAL_HISTORY_KEY = 'sandkasten-terminal-history-v1';
export const TERMINAL_HISTORY_LIMIT = 8;

function readHistory(storage: Storage | undefined): string[] {
  try {
    const stored = storage?.getItem(TERMINAL_HISTORY_KEY);
    if (!stored) return [];
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is string => typeof entry === 'string' && entry !== '').slice(0, TERMINAL_HISTORY_LIMIT);
  } catch {
    return [];
  }
}

function writeHistory(storage: Storage | undefined, values: readonly string[]): void {
  try {
    storage?.setItem(TERMINAL_HISTORY_KEY, JSON.stringify(values));
  } catch {
    // Storage can be unavailable or full; the history is only a convenience.
  }
}

function localHistoryStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

const CD_VERBS = new Set(['cd', 'chdir', 'sl', 'set-location']);
const PUSHD_VERB = 'pushd';
const POPD_VERB = 'popd';
// `cd -` means "the directory I came from" in the POSIX shells and in NuShell.
// cmd has no such thing, and Windows PowerShell's `cd -` fails too, so neither is
// followed there: guessing would move the completions somewhere the shell is not.
const PREVIOUS_DIRECTORY_FAMILIES = new Set(['bash', 'posix', 'wsl', 'nu']);

/** The path of one `cd`-like command, or the push/pop shape of a directory stack. */
function parseDirectoryChange(line: string): { path?: string; push?: boolean; pop?: boolean } | undefined {
  const parts = /^\s*(\S+)(?:\s+(.*))?$/.exec(line);
  if (!parts) return undefined;
  const verb = parts[1].toLowerCase();
  const rest = (parts[2] ?? '').trim();
  if (verb === POPD_VERB && !rest) return { pop: true };
  if (verb !== PUSHD_VERB && !CD_VERBS.has(verb)) return undefined;
  const path = unquotedPath(rest);
  return path ? { path, push: verb === PUSHD_VERB } : { push: verb === PUSHD_VERB };
}

/**
 * The literal path of one argument. A quoted path keeps its spaces; anything the
 * shell would expand is rejected, because this model resolves the path itself.
 */
function unquotedPath(text: string): string {
  const quoted = /^"([^"]*)"$/.exec(text) ?? /^'([^']*)'$/.exec(text);
  if (!quoted && /\s/.test(text)) return '';
  const value = (quoted ? quoted[1] : text).replace(/^\.\//, '');
  return /[$`*?<>|;&]/.test(value) ? '' : value;
}

/** The folder a relative path names, or undefined when it climbs above the root. */
function resolveRelative(from: string, target: string): string | undefined {
  const segments = from ? from.split('/') : [];
  for (const segment of target.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (!segments.length) return undefined;
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.join('/');
}

/** The App owns this controller; panel components only borrow its DOM hosts. */
export function useTerminal(bridge: TerminalBridge, options: TerminalOptions = {}) {
  const inputPaths = options.paths ?? (() => []);
  const profiles = shallowRef<TerminalProfile[]>([]);
  const sessions = shallowRef<TerminalEntry[]>([]);
  const activeId = ref('');
  const visibleIds = ref<string[]>([]);
  const shown = ref(false);
  const pending = ref(0);
  const error = ref('');
  // Command names per profile id, fetched once per profile and kept for the
  // session: the list is what the palette offers for the shell in front of the
  // user, and the main process only ever sends names.
  const commandNames = shallowRef<Record<string, readonly string[]>>({});
  // The subset the shell reports about itself (a cmdlet, a builtin). The palette
  // shows the difference, so the user can tell `Get-ChildItem` from `git`.
  const shellReportedNames = shallowRef<Record<string, readonly string[]>>({});
  // Profiles whose list actually arrived. An empty answer is not a result: it is
  // what a cold or unreachable shell reports, so the next request has to ask
  // again instead of serving the empty list for the rest of the session.
  const loadedCommands = new Set<string>();
  // A best-effort model of the shell's current input line, used only to suggest
  // commands. Anything the model cannot follow (an arrow key, a control byte it
  // does not handle) empties it, so a wrong suggestion is never offered from a
  // line the terminal emulator has lost track of.
  const inputLine = ref('');
  let inEscape = false;
  // Where the active session's shell is, as far as a plain `cd` can be followed.
  // Empty means the workspace root, which is where a session starts.
  const workspaceCwd = ref('');
  // Where pushd can send it back to.
  const cwdStack = ref<string[]>([]);
  // Where cd - sends the shell back to.
  const previousCwd = ref('');
  // What the user already accepted, most recent first: among equally matching
  // suggestions the ones already used lead the strip, the way a shell's own
  // history does. It survives a restart, because a shell's habits do.
  const historyStorage = options.history ?? localHistoryStorage();
  const acceptedValues = ref<string[]>(readHistory(historyStorage));
  const views = new Map<string, SessionView>();
  let disposed = false;
  let focused = false;

  const activeProfileId = computed(() => sessions.value.find((entry) => entry.id === activeId.value)?.profileId ?? '');
  // The shell a new session would start: the palette uses it while the panel has
  // no session yet.
  const defaultProfileId = computed(() => profiles.value.find((profile) => profile.isDefault)?.id ?? profiles.value[0]?.id ?? '');

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
      if (disposed) return;
      profiles.value = discovered;
      // The palette offers a shell's commands before the panel is ever opened,
      // so the default profile's list is fetched with the profiles themselves.
      if (!activeProfileId.value && defaultProfileId.value) void loadCommands(defaultProfileId.value);
    } catch (cause) { report(cause); }
  }

  async function loadCommands(profileId = activeProfileId.value): Promise<readonly string[]> {
    if (disposed || !profileId) return [];
    if (loadedCommands.has(profileId)) return commandNames.value[profileId] ?? [];
    try {
      const list = await bridge.commands(profileId);
      if (disposed) return [];
      const names = Array.isArray(list) ? list : list?.names ?? [];
      const reported = Array.isArray(list) ? [] : list?.shellReported ?? [];
      commandNames.value = { ...commandNames.value, [profileId]: names };
      shellReportedNames.value = { ...shellReportedNames.value, [profileId]: reported };
      if (names.length) loadedCommands.add(profileId);
      return names;
    } catch (cause) {
      report(cause);
      return [];
    }
  }

  // The list belongs to the shell the user is looking at, so it is fetched when
  // that shell becomes the active session.
  watch(activeProfileId, (profileId) => { if (profileId) void loadCommands(profileId); }, { immediate: true });

  // The command word completes from the shell's published commands, and an
  // argument completes from the workspace, so `python mai…` offers main.py.
  function orderByHistory<T extends { value: string }>(items: T[]): T[] {
    const accepted = acceptedValues.value;
    if (!accepted.length) return items;
    return [...items.filter((item) => accepted.includes(item.value)), ...items.filter((item) => !accepted.includes(item.value))];
  }

  const suggestions = computed<TerminalSuggestion[]>(() => {
    const line = inputLine.value;
    if (!line) return [];
    // Everything after the command word is an argument, so the last token is the
    // one being typed — even when earlier arguments are already on the line.
    const parts = line.split(/\s+/);
    if (parts.length > 1) {
      const token = parts.at(-1) ?? '';
      if (!token) return [];
      return orderByHistory(relativePaths()
        .filter((path) => path.toLowerCase().startsWith(token.toLowerCase()))
        .map((path) => ({ label: path, value: path })))
        .slice(0, 5);
    }
    const lower = line.toLowerCase();
    const names = commandNames.value[activeProfileId.value] ?? [];
    const reported = new Set(shellReportedNames.value[activeProfileId.value] ?? []);
    const matches = names
      .filter((name) => name.toLowerCase().startsWith(lower) && name.toLowerCase() !== lower)
      .map((name) => ({ label: name, value: name, reported: reported.has(name) }));
    // The list puts the PATH executables first, so in a PowerShell session a
    // cmdlet would never reach the five entries the strip shows. Both kinds take
    // turns, with what the user already accepted leading within its own kind.
    const executables = orderByHistory(matches.filter((entry) => !entry.reported));
    const shellCommands = orderByHistory(matches.filter((entry) => entry.reported));
    // The marker shares the slots and also says which kind each entry is.
    const ordered: Array<TerminalSuggestion & { reported: boolean }> = [];
    for (let index = 0; ordered.length < 5 && (index < executables.length || index < shellCommands.length); index += 1) {
      if (executables[index]) ordered.push(executables[index]);
      if (shellCommands[index] && ordered.length < 5) ordered.push(shellCommands[index]);
    }
    return ordered.map(({ label, value, reported }) => (reported ? { label, value, source: 'shell' } : { label, value }));
  });

  // The workspace paths as the shell would see them: a session that has moved
  // into a folder completes the names inside it, not paths from the workspace
  // root that no longer resolve there.
  function relativePaths(): string[] {
    const prefix = workspaceCwd.value ? `${workspaceCwd.value}/` : '';
    if (!prefix) return [...inputPaths()];
    return inputPaths()
      .filter((path) => path.startsWith(prefix))
      .map((path) => path.slice(prefix.length))
      .filter(Boolean);
  }

  /**
   * Follow the shell's own directory changes so completions keep matching where
   * it is. `cd` and its synonyms (`chdir`, `sl`, `Set-Location`) are followed,
   * `pushd`/`popd` keep a stack, and a quoted path may contain spaces. Only a
   * single path with nothing the shell would expand is tracked, and only into a
   * folder the workspace really has: a move this model cannot follow leaves it
   * where it was, which is no worse than the workspace-root assumption it
   * started with.
   */
  function noteSubmitted(line: string): void {
    const change = parseDirectoryChange(line);
    if (!change) return;
    if (change.pop) {
      const previous = cwdStack.value.at(-1);
      if (previous === undefined) return;
      cwdStack.value = cwdStack.value.slice(0, -1);
      rememberDirectory();
      workspaceCwd.value = previous;
      return;
    }
    if (!change.path) return;
    if (change.path === '-') {
      const family = profiles.value.find((profile) => profile.id === activeProfileId.value)?.family ?? '';
      if (!PREVIOUS_DIRECTORY_FAMILIES.has(family)) return;
      const target = previousCwd.value;
      previousCwd.value = workspaceCwd.value;
      workspaceCwd.value = target;
      return;
    }
    const candidate = resolveRelative(workspaceCwd.value, change.path);
    // A path that climbs above the workspace root is not one this model can name.
    if (candidate === undefined) return;
    if (candidate && !inputPaths().includes(`${candidate}/`)) return;
    if (change.push) cwdStack.value = [...cwdStack.value, workspaceCwd.value];
    rememberDirectory();
    workspaceCwd.value = candidate;
  }

  function rememberDirectory(): void {
    previousCwd.value = workspaceCwd.value;
  }

  function trackInput(data: string): void {
    for (const character of data) {
      if (inEscape) {
        // An escape sequence ends on its final byte; anything in between is not
        // input the user typed.
        if (/[A-Za-z~]/.test(character)) inEscape = false;
        continue;
      }
      if (character === '\x1b') { inputLine.value = ''; inEscape = true; continue; }
      if (character === '\r' || character === '\n') { noteSubmitted(inputLine.value); inputLine.value = ''; continue; }
      if (character === '\x03' || character === '\x04') { inputLine.value = ''; continue; }
      if (character === '\x7f' || character === '\b') { inputLine.value = inputLine.value.slice(0, -1); continue; }
      if (character === '\t') continue;
      if (character < ' ') { inputLine.value = ''; continue; }
      inputLine.value += character;
    }
  }

  function removeView(id: string): void {
    inputLine.value = '';
    workspaceCwd.value = '';
    cwdStack.value = [];
    previousCwd.value = '';
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
      // Let the App handle its terminal shortcuts; the suggestion shortcut is only
  // taken while a suggestion exists, so the shell keeps every other key.
      terminal.attachCustomKeyEventHandler((event) => {
        if (isTerminalShortcut(event)) return false;
        const clipboard = clipboardActionFor(event);
        if (clipboard) {
          void useClipboard(clipboard);
          return false;
        }
        if (isSuggestionShortcut(event) && id === activeId.value && suggestions.value.length) {
          void complete(suggestions.value[0]);
          return false;
        }
        return true;
      });
      const host = document.createElement('div');
      host.className = 'terminal-host';

      /** Copy, paste and select-all for this view. */
      async function useClipboard(action: 'copy' | 'paste' | 'select-all') {
        try {
          if (action === 'select-all') {
            terminal.selectAll();
            return;
          }
          if (action === 'copy') {
            const selection = terminal.getSelection();
            if (!selection) return;
            if (bridge.clipboard) await bridge.clipboard.write(selection);
            else await navigator.clipboard?.writeText(selection);
            return;
          }
          // Paste goes to the shell as input, the same way typed text does.
          const text = bridge.clipboard
            ? await bridge.clipboard.read()
            : await navigator.clipboard?.readText() ?? '';
          if (!text) return;
          if (sessions.value.find((entry) => entry.id === id)?.exitCode === undefined) {
            await bridge.write({ id, data: text });
          }
        } catch (error) {
          report(error);
        }
      }
      const subscriptions = [
        terminal.onData((data) => {
          // Only the session the user is looking at owns the suggestion model.
          if (id === activeId.value) trackInput(data);
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
      // A new shell starts on its own empty prompt, at the workspace root.
      inputLine.value = '';
      workspaceCwd.value = '';
      cwdStack.value = [];
      previousCwd.value = '';
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
    if (activeId.value !== id) { inputLine.value = ''; workspaceCwd.value = ''; cwdStack.value = []; previousCwd.value = ''; }
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

  // Types into the shell the way a keyboard would. Refuses when the active
  // session is gone, exited, or not mounted as a view.
  async function writeRaw(data: string): Promise<boolean> {
    if (disposed || data === '') return false;
    const id = activeId.value;
    const session = sessions.value.find((entry) => entry.id === id);
    if (!session || session.exitCode !== undefined || !views.has(id)) return false;
    try {
      await bridge.write({ id, data });
    } catch (cause) {
      report(cause);
      return false;
    }
    views.get(id)?.terminal.focus();
    return true;
  }

  async function send(text: string): Promise<boolean> {
    if (typeof text !== 'string' || text === '') return false;
    if (!(await writeRaw(`${text}\r`))) return false;
    inputLine.value = '';
    return true;
  }

  // Types the rest of the suggested word without running it, so the user can add
  // arguments and press Enter themselves. A path that needs quoting replaces the
  // typed token instead of continuing it, because the quoted form is not a
  // continuation.
  async function complete(suggestion: TerminalSuggestion): Promise<boolean> {
    const line = inputLine.value;
    const value = suggestion?.value ?? '';
    if (!value) return false;
    const start = Math.max(line.lastIndexOf(' '), line.lastIndexOf('\t')) + 1;
    const token = line.slice(start);
    if (!value.toLowerCase().startsWith(token.toLowerCase())) return false;
    const family = profiles.value.find((profile) => profile.id === activeProfileId.value)?.family;
    const insert = /[\s'"&|<>()$`;]/.test(value) ? quoteForShell(family, value) : value;
    const data = insert.startsWith(token) ? insert.slice(token.length) : `${'\x7f'.repeat(token.length)}${insert}`;
    if (!(await writeRaw(data))) return false;
    inputLine.value = line.slice(0, start) + insert;
    acceptedValues.value = [value, ...acceptedValues.value.filter((entry) => entry !== value)].slice(0, TERMINAL_HISTORY_LIMIT);
    writeHistory(historyStorage, acceptedValues.value);
    return true;
  }

  return {
    profiles: readonly(profiles), sessions: readonly(sessions), activeId: readonly(activeId),
    activeProfileId, defaultProfileId, commandNames: readonly(commandNames),
    shellReportedNames: readonly(shellReportedNames),
    inputLine: readonly(inputLine), suggestions, complete, history: readonly(acceptedValues),
    visibleIds: readonly(visibleIds), shown: readonly(shown), pending: readonly(pending), error: readonly(error),
    loadProfiles, create, split, select, close, mount, unmount, fit, syncTheme, dispose, setFocused, send, loadCommands,
    show: () => { shown.value = true; }, showOutput: () => { shown.value = false; },
    focus: () => { views.get(activeId.value)?.terminal.focus(); },
  };
}

export function isTerminalShortcut(event: KeyboardEvent): boolean {
  return (event.ctrlKey || event.metaKey) && !event.altKey
    && (event.code === 'Backquote' || event.key === '`' || event.key === '~');
}

/** The editor-style accept key; Tab stays with the shell's own completion. */
export function isSuggestionShortcut(event: KeyboardEvent): boolean {
  return (event.ctrlKey || event.metaKey) && !event.altKey && (event.code === 'Space' || event.key === ' ');
}

/**
 * The clipboard keys, which the terminal has to take before xterm sends them to the
 * shell: `Ctrl+V` belongs to the shell, so copy and paste are `Ctrl+Shift+…` on
 * Windows and Linux and plain `Cmd+…` on macOS, as in the terminals people know.
 */
export function clipboardActionFor(event: KeyboardEvent): 'copy' | 'paste' | 'select-all' | null {
  if (event.altKey) return null;
  const key = event.key?.toLowerCase();
  const command = event.metaKey && !event.ctrlKey;
  const controlShift = event.ctrlKey && event.shiftKey;
  if (!command && !controlShift) return null;
  if (key === 'c') return 'copy';
  if (key === 'v') return 'paste';
  if (key === 'a' && controlShift) return 'select-all';
  return null;
}

export type TerminalController = ReturnType<typeof useTerminal>;
