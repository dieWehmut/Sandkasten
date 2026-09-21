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
  createFolder(path: string): Promise<{ path: string }>;
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

// Scratch workspaces store a flat file map, but folders have to be visible:
// every intermediate segment becomes a directory node, and empty folders that
// were created explicitly are remembered alongside the files.
function flatTree(files: FileMap, folders: readonly string[] = []): WorkspaceTreeNode[] {
  const directories = new Map<string, WorkspaceTreeNode>();
  const directoryOf = (path: string): WorkspaceTreeNode => {
    const existing = directories.get(path);
    if (existing) return existing;
    const node: WorkspaceTreeNode = {
      path,
      name: path.split('/').at(-1) ?? path,
      type: 'directory',
      children: [],
    };
    directories.set(path, node);
    const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    if (parent) directoryOf(parent).children?.push(node);
    return node;
  };
  // Folders own every segment including their own name; a file only owns the
  // directories above it, so the file itself never becomes a directory node.
  for (const path of folders) {
    const segments = path.split('/');
    for (let index = 1; index <= segments.length; index += 1) directoryOf(segments.slice(0, index).join('/'));
  }
  for (const path of Object.keys(files)) {
    const segments = path.split('/');
    for (let index = 1; index < segments.length; index += 1) directoryOf(segments.slice(0, index).join('/'));
  }
  const roots: WorkspaceTreeNode[] = [];
  for (const [path, node] of directories) {
    if (!path.includes('/')) roots.push(node);
  }
  for (const path of Object.keys(files).sort((left, right) => left.localeCompare(right))) {
    const parent = path.includes('/') ? directories.get(path.slice(0, path.lastIndexOf('/'))) : undefined;
    const node: WorkspaceTreeNode = { path, name: path.split('/').at(-1) ?? path, type: 'file' };
    if (parent) parent.children?.push(node);
    else roots.push(node);
  }
  const sort = (nodes: WorkspaceTreeNode[]): WorkspaceTreeNode[] => {
    nodes.sort((left, right) => {
      if (left.type !== right.type) return left.type === 'directory' ? -1 : 1;
      return left.name.localeCompare(right.name);
    });
    for (const node of nodes) if (node.children?.length) sort(node.children);
    return nodes;
  };
  return sort(roots);
}

export function createMemoryWorkspaceStore(): WorkspaceStore {
  let files = parseStoredFiles(storage()?.getItem(WORKSPACE_STORAGE_KEY) ?? null);
  let folders: string[] = [];

  function persist(): void {
    storage()?.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify({ files, folders }));
  }

  // Restore the remembered folders so an empty directory survives a reload.
  try {
    const stored = JSON.parse(storage()?.getItem(WORKSPACE_STORAGE_KEY) ?? '{}');
    if (Array.isArray(stored?.folders)) {
      folders = stored.folders.filter((entry: unknown): entry is string => typeof entry === 'string' && entry.trim() !== '');
    }
  } catch { /* A malformed store falls back to the files that parsed. */ }

  return {
    kind: 'memory',
    async root() {
      return { path: '', name: 'Scratch' };
    },
    async openFolder() {
      return null;
    },
    async list() {
      return flatTree(files, folders);
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
    async createFolder(path) {
      const normalized = path.split('/').filter(Boolean).join('/');
      if (!normalized) throw new Error('Enter a folder name');
      if (normalized in files) throw new Error(`A file named ${normalized} already exists`);
      if (!folders.includes(normalized)) folders = [...folders, normalized];
      persist();
      return { path: normalized };
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
    createFolder: (path) => bridge.workspace.createFolder(path),
    remove: (path) => bridge.workspace.remove(path),
  };
}

export function resolveWorkspaceStore(bridge: DesktopBridge | undefined = desktopBridge()): WorkspaceStore {
  return bridge ? createDesktopWorkspaceStore(bridge) : createMemoryWorkspaceStore();
}
