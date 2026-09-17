// Workspace storage adapters. The browser keeps a small flat scratch workspace
// in localStorage; the desktop build reads and writes real folders through the
// Electron bridge. Both expose the same async contract so the IDE shell does
// not branch on the environment.

import {
  desktopBridge,
  type DesktopBridge,
  type WorkspaceRoot,
  type WorkspaceTreeNode,
} from './desktopBridge';

export const WORKSPACE_STORAGE_KEY = 'sandkasten-workspace-v1';
export const SCRATCH_FILE_NAME = 'main.py';
export const SCRATCH_FILE_SOURCE = `def main():
    print("Hello from Sandkasten")


if __name__ == "__main__":
    main()
`;

export interface WorkspaceStore {
  readonly kind: 'memory' | 'desktop';
  root(): Promise<WorkspaceRoot | null>;
  openFolder(): Promise<WorkspaceRoot | null>;
  list(): Promise<WorkspaceTreeNode[]>;
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
  create(path: string, content: string): Promise<void>;
  remove(path: string): Promise<void>;
}

type FileMap = Record<string, string>;

function scratchFiles(): FileMap {
  return { [SCRATCH_FILE_NAME]: SCRATCH_FILE_SOURCE };
}

function parseStoredFiles(raw: string | null): FileMap {
  if (!raw) return scratchFiles();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return scratchFiles();
    const files = (parsed as { files?: unknown }).files;
    if (!files || typeof files !== 'object' || Array.isArray(files)) return scratchFiles();
    const entries = Object.entries(files as Record<string, unknown>)
      .filter(([path, value]) => typeof path === 'string' && path.trim() !== '' && typeof value === 'string');
    return entries.length ? Object.fromEntries(entries) : scratchFiles();
  } catch {
    return scratchFiles();
  }
}

function storage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

function flatTree(files: FileMap): WorkspaceTreeNode[] {
  return Object.keys(files)
    .sort((left, right) => left.localeCompare(right))
    .map((path) => ({ path, name: path.split('/').at(-1) ?? path, type: 'file' as const }));
}

export function createMemoryWorkspaceStore(): WorkspaceStore {
  let files = parseStoredFiles(storage()?.getItem(WORKSPACE_STORAGE_KEY) ?? null);

  function persist(): void {
    storage()?.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify({ files }));
  }

  return {
    kind: 'memory',
    async root() {
      return { path: '', name: 'Scratch' };
    },
    async openFolder() {
      return null;
    },
    async list() {
      return flatTree(files);
    },
    async read(path) {
      const value = files[path];
      if (typeof value !== 'string') throw new Error(`Unknown workspace file: ${path}`);
      return value;
    },
    async write(path, content) {
      if (!(path in files)) throw new Error(`Unknown workspace file: ${path}`);
      files = { ...files, [path]: content };
      persist();
    },
    async create(path, content) {
      if (path in files) throw new Error(`A file named ${path} already exists`);
      files = { ...files, [path]: content };
      persist();
    },
    async remove(path) {
      if (!(path in files)) throw new Error(`Unknown workspace file: ${path}`);
      const { [path]: _removed, ...rest } = files;
      files = rest;
      if (!Object.keys(files).length) files = scratchFiles();
      persist();
    },
  };
}

export function createDesktopWorkspaceStore(bridge: DesktopBridge): WorkspaceStore {
  return {
    kind: 'desktop',
    root: () => bridge.workspace.root(),
    openFolder: () => bridge.workspace.openFolder(),
    list: () => bridge.workspace.list(),
    read: (path) => bridge.workspace.read(path),
    write: (path, content) => bridge.workspace.write(path, content),
    create: (path, content) => bridge.workspace.create(path, content),
    remove: (path) => bridge.workspace.remove(path),
  };
}

export function resolveWorkspaceStore(bridge: DesktopBridge | undefined = desktopBridge()): WorkspaceStore {
  return bridge ? createDesktopWorkspaceStore(bridge) : createMemoryWorkspaceStore();
}