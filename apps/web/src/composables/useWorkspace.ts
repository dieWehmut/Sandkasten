import { computed, readonly, ref, type ComputedRef, type Ref } from 'vue';
import type { WorkspaceRoot, WorkspaceTreeNode } from '../services/desktopBridge';
import {
  SCRATCH_FILE_NAME,
  resolveWorkspaceStore,
  type WorkspaceStore,
} from '../services/workspaceStore';
import { languageForPath } from '../editor/language';

export type WorkspaceStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface WorkspaceFile {
  path: string;
  name: string;
  language: string;
  source: string;
  dirty: boolean;
}

export interface WorkspaceController {
  store: WorkspaceStore;
  isDesktop: ComputedRef<boolean>;
  status: Readonly<Ref<WorkspaceStatus>>;
  error: Readonly<Ref<string | undefined>>;
  root: Readonly<Ref<WorkspaceRoot | undefined>>;
  tree: Readonly<Ref<WorkspaceTreeNode[]>>;
  files: Readonly<Ref<WorkspaceFile[]>>;
  activePath: Readonly<Ref<string>>;
  activeFile: ComputedRef<WorkspaceFile | undefined>;
  dirtyCount: ComputedRef<number>;
  initialize(): Promise<void>;
  openFolder(): Promise<boolean>;
  refreshTree(): Promise<void>;
  openFile(path: string): Promise<void>;
  createFile(name: string, language?: string): Promise<string>;
  closeFile(path: string): void;
  removeFile(path: string): Promise<void>;
  setActive(path: string): void;
  updateSource(source: string): void;
  setLanguage(language: string): void;
  saveActive(): Promise<boolean>;
}

const STARTERS: Readonly<Record<string, (name: string) => string>> = {
  python: () => 'print("Hello from Sandkasten")\n',
  javascript: () => 'console.log("Hello from Sandkasten");\n',
  typescript: () => 'const message: string = "Hello from Sandkasten";\nconsole.log(message);\n',
  go: () => 'package main\n\nimport "fmt"\n\nfunc main() {\n\tfmt.Println("Hello from Sandkasten")\n}\n',
  rust: () => 'fn main() {\n    println!("Hello from Sandkasten");\n}\n',
  c: () => '#include <stdio.h>\n\nint main(void) {\n    puts("Hello from Sandkasten");\n    return 0;\n}\n',
  cpp: () => '#include <iostream>\n\nint main() {\n    std::cout << "Hello from Sandkasten" << std::endl;\n    return 0;\n}\n',
  java: () => 'public class Main {\n    public static void main(String[] args) {\n        System.out.println("Hello from Sandkasten");\n    }\n}\n',
  bash: () => '#!/usr/bin/env bash\necho "Hello from Sandkasten"\n',
  ruby: () => 'puts "Hello from Sandkasten"\n',
  php: () => '<?php\necho "Hello from Sandkasten\\n";\n',
  sql: () => 'SELECT 1 AS hello;\n',
};

export function starterSource(language: string, name: string): string {
  const make = STARTERS[language];
  return make ? make(name) : `// ${name}\n`;
}

function baseName(path: string): string {
  return path.split(/[\\/]/).at(-1) ?? path;
}

function firstFile(nodes: readonly WorkspaceTreeNode[]): string {
  const queue = [...nodes];
  const found: string[] = [];
  while (queue.length) {
    const node = queue.shift() as WorkspaceTreeNode;
    if (node.type === 'file') found.push(node.path);
    else if (node.children) queue.push(...node.children);
  }
  if (found.includes(SCRATCH_FILE_NAME)) return SCRATCH_FILE_NAME;
  return found.sort((left, right) => left.localeCompare(right))[0] ?? '';
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function assertSimpleName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Enter a file name');
  if (trimmed.includes('/') || trimmed.includes('\\') || trimmed.includes('\0')) {
    throw new Error('File names cannot contain path separators');
  }
  if (trimmed === '.' || trimmed === '..') throw new Error('Enter a valid file name');
  return trimmed;
}

export function useWorkspace(): WorkspaceController {
  const store = resolveWorkspaceStore();
  const status = ref<WorkspaceStatus>('idle');
  const error = ref<string>();
  const root = ref<WorkspaceRoot>();
  const tree = ref<WorkspaceTreeNode[]>([]);
  const files = ref<WorkspaceFile[]>([]);
  const activePath = ref('');
  const isDesktop = computed(() => store.kind === 'desktop');

  const activeFile = computed(() => files.value.find((file) => file.path === activePath.value));
  const dirtyCount = computed(() => files.value.filter((file) => file.dirty).length);

  function openPaths(): string[] {
    return files.value.map((file) => file.path);
  }

  async function refreshTree(): Promise<void> {
    tree.value = await store.list();
  }

  async function openFile(path: string): Promise<void> {
    if (!path) return;
    const existing = files.value.find((file) => file.path === path);
    if (existing) {
      activePath.value = path;
      return;
    }
    const source = await store.read(path);
    files.value = [
      ...files.value,
      { path, name: baseName(path), language: languageForPath(path), source, dirty: false },
    ];
    activePath.value = path;
  }

  async function initialize(): Promise<void> {
    status.value = 'loading';
    error.value = undefined;
    try {
      root.value = (await store.root()) ?? undefined;
      await refreshTree();
      const first = files.value.length ? '' : firstFile(tree.value);
      if (first) await openFile(first);
      status.value = 'ready';
    } catch (cause) {
      error.value = messageFrom(cause);
      status.value = 'error';
    }
  }

  async function openFolder(): Promise<boolean> {
    status.value = 'loading';
    error.value = undefined;
    try {
      const selected = await store.openFolder();
      if (!selected) {
        status.value = 'ready';
        return false;
      }
      root.value = selected;
      files.value = [];
      activePath.value = '';
      await refreshTree();
      const first = firstFile(tree.value);
      if (first) await openFile(first);
      status.value = 'ready';
      return true;
    } catch (cause) {
      error.value = messageFrom(cause);
      status.value = 'error';
      return false;
    }
  }

  async function createFile(name: string, language = ''): Promise<string> {
    error.value = undefined;
    try {
      const fileName = assertSimpleName(name);
      if (openPaths().includes(fileName)) {
        await openFile(fileName);
        return fileName;
      }
      const detected = language || languageForPath(fileName) || 'python';
      await store.create(fileName, starterSource(detected, fileName));
      await refreshTree();
      await openFile(fileName);
      return fileName;
    } catch (cause) {
      error.value = messageFrom(cause);
      throw cause instanceof Error ? cause : new Error(messageFrom(cause));
    }
  }

  async function removeFile(path: string): Promise<void> {
    error.value = undefined;
    try {
      await store.remove(path);
      closeFile(path);
      await refreshTree();
      const next = firstFile(tree.value);
      if (!files.value.length && next) await openFile(next);
    } catch (cause) {
      error.value = messageFrom(cause);
    }
  }

  function closeFile(path: string): void {
    const index = files.value.findIndex((file) => file.path === path);
    if (index === -1) return;
    const remaining = files.value.filter((file) => file.path !== path);
    files.value = remaining;
    if (activePath.value === path) {
      activePath.value = (remaining[index] ?? remaining[index - 1] ?? remaining[0])?.path ?? '';
    }
  }

  function setActive(path: string): void {
    if (files.value.some((file) => file.path === path)) activePath.value = path;
  }

  function patchActive(patch: (file: WorkspaceFile) => WorkspaceFile): void {
    files.value = files.value.map((file) => (file.path === activePath.value ? patch(file) : file));
  }

  function updateSource(source: string): void {
    patchActive((file) => (file.source === source ? file : { ...file, source, dirty: true }));
  }

  function setLanguage(language: string): void {
    patchActive((file) => (file.language === language ? file : { ...file, language, dirty: file.dirty }));
  }

  async function saveActive(): Promise<boolean> {
    const file = activeFile.value;
    if (!file) return false;
    error.value = undefined;
    try {
      await store.write(file.path, file.source);
      files.value = files.value.map((candidate) => (
        candidate.path === file.path ? { ...candidate, dirty: false } : candidate
      ));
      return true;
    } catch (cause) {
      error.value = messageFrom(cause);
      return false;
    }
  }

  return {
    store,
    isDesktop,
    status: readonly(status),
    error: readonly(error),
    root: readonly(root),
    tree: readonly(tree),
    files: readonly(files),
    activePath: readonly(activePath),
    activeFile,
    dirtyCount,
    initialize,
    openFolder,
    refreshTree,
    openFile,
    createFile,
    closeFile,
    removeFile,
    setActive,
    updateSource,
    setLanguage,
    saveActive,
  };
}