// Typed access to the Electron preload bridge. The browser build has no bridge,
// so every accessor degrades to `undefined` and callers fall back to the
// in-memory workspace and the remote Sandkasten API.

export interface WorkspaceRoot {
  path: string;
  name: string;
}

export interface WorkspaceTreeNode {
  path: string;
  name: string;
  type: 'file' | 'directory';
  children?: WorkspaceTreeNode[];
}

export interface LocalRuntimeInfo {
  language: string;
  label: string;
  command: string;
  available: boolean;
  extensions: string[];
}

export interface LocalRunRequest {
  jobId: string;
  path: string;
  language: string;
  timeoutMs?: number;
}

export interface IsolatedRunRequest {
  jobId: string;
  path: string;
  language: string;
  command: string;
  args?: string[];
  timeoutMs?: number;
}

export interface IsolationStatus {
  available: boolean;
  distro: string;
  pidIsolated: boolean;
  networkBlocked: boolean;
}

export interface LocalRunOutput {
  jobId: string;
  status: string;
  language: string;
  stdout: string;
  stderr: string;
  compileStdout?: string;
  compileStderr?: string;
  stdoutEncoding: string;
  stderrEncoding: string;
  compileStdoutEncoding?: string;
  compileStderrEncoding?: string;
  exitCode?: number;
  signal?: number;
  durationMs?: number;
  errorMessage?: string;
  truncated?: { stdout?: boolean; stderr?: boolean };
  command?: string;
}

/** Menu identifiers the native chrome accepts; keep in sync with the main process. */
export const WINDOW_MENU_IDS = ['file', 'edit', 'run', 'view', 'help'] as const;
export type WindowMenuId = typeof WINDOW_MENU_IDS[number];

export interface WindowMenuRequest {
  id: WindowMenuId;
  /** Anchor in CSS pixels; the main process scales it by the zoom factor. */
  x: number;
  y: number;
  locale: 'en' | 'zh-CN';
}

/**
 * The Electron window runs with a hidden title bar, so the renderer owns the
 * title row: it themes the native overlay controls and opens the real native
 * menus below its own buttons.
 */
export interface WindowChromeBridge {
  integrated: true;
  setTheme(theme: 'light' | 'dark'): Promise<void>;
  showMenu(request: WindowMenuRequest): Promise<void>;
}

export interface DesktopBridge {
  platform: string;
  versions: { chrome?: string; electron?: string };
  workspace: {
    openFolder(): Promise<WorkspaceRoot | null>;
    root(): Promise<WorkspaceRoot | null>;
    list(): Promise<WorkspaceTreeNode[]>;
    read(path: string): Promise<string>;
    write(path: string, content: string): Promise<void>;
    create(path: string, content: string): Promise<void>;
    remove(path: string): Promise<void>;
  };
  runner: {
    detect(): Promise<LocalRuntimeInfo[]>;
    run(request: LocalRunRequest): Promise<LocalRunOutput>;
    stop(jobId: string): Promise<boolean>;
  };
  isolated?: {
    detect(): Promise<IsolationStatus>;
    run(request: IsolatedRunRequest): Promise<LocalRunOutput>;
    stop(jobId: string): Promise<boolean>;
  };
  onMenuCommand(handler: (command: string) => void): void;
  windowChrome?: WindowChromeBridge;
}

export function desktopBridge(): DesktopBridge | undefined {
  if (typeof window === 'undefined') return undefined;
  const candidate = (window as unknown as { sandkastenDesktop?: Partial<DesktopBridge> }).sandkastenDesktop;
  if (!candidate || typeof candidate !== 'object') return undefined;
  if (!candidate.workspace || !candidate.runner) return undefined;
  return candidate as DesktopBridge;
}

export function isDesktopRuntime(): boolean {
  return desktopBridge() !== undefined;
}
