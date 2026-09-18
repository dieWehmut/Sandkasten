// Workspace folder access for the desktop app. Every path that arrives from the
// renderer is confined to the folder the user opened: the renderer never picks
// an absolute path, and the main process rejects anything that escapes the root.
import { mkdir, readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const IGNORED_DIRECTORIES = new Set([
  '.git',
  '.hg',
  '.svn',
  '.idea',
  '.vscode',
  '.next',
  '.venv',
  '.cache',
  '__pycache__',
  'build',
  'dist',
  'node_modules',
  'target',
]);

export const MAX_TREE_ENTRIES = 2000;
export const MAX_TREE_DEPTH = 6;
export const MAX_FILE_BYTES = 2 * 1024 * 1024;

export function normalizeRelativePath(input) {
  if (typeof input !== 'string' || input.trim() === '') {
    throw new Error('a workspace file path is required');
  }
  const value = input.trim().replaceAll('\\', '/');
  if (value.includes('\0')) throw new Error('workspace paths must not contain NUL bytes');
  if (value.startsWith('/') || /^[A-Za-z]:/.test(value)) {
    throw new Error('workspace paths must be relative to the opened folder');
  }
  const segments = value.split('/').filter((segment) => segment !== '' && segment !== '.');
  if (!segments.length) throw new Error('a workspace file path is required');
  if (segments.includes('..')) throw new Error('workspace paths must not escape the opened folder');
  return segments.join('/');
}

export function resolveInsideRoot(root, relativePath) {
  if (typeof root !== 'string' || root.trim() === '') {
    throw new Error('open a workspace folder first');
  }
  const normalized = normalizeRelativePath(relativePath);
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, normalized);
  const relative = path.relative(resolvedRoot, resolved);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('workspace paths must stay inside the opened folder');
  }
  return resolved;
}

async function readDirectory(directory) {
  return readdir(directory, { withFileTypes: true }).catch((error) => {
    if (error?.code === 'ENOENT') return [];
    throw error;
  });
}

export async function listWorkspaceTree(root, options = {}) {
  const maxEntries = Number.isInteger(options.maxEntries) ? options.maxEntries : MAX_TREE_ENTRIES;
  const maxDepth = Number.isInteger(options.maxDepth) ? options.maxDepth : MAX_TREE_DEPTH;
  const ignored = options.ignored ?? IGNORED_DIRECTORIES;
  const rootStats = await stat(path.resolve(root)).catch(() => null);
  if (!rootStats?.isDirectory()) throw new Error(`workspace folder not found: ${root}`);

  let entries = 0;
  let truncated = false;

  async function walk(directory, depth) {
    if (depth > maxDepth || entries >= maxEntries) {
      truncated = true;
      return [];
    }
    const dirents = (await readDirectory(directory))
      .filter((entry) => !entry.isSymbolicLink())
      .filter((entry) => !(entry.isDirectory() && ignored.has(entry.name)))
      .sort((left, right) => {
        if (left.isDirectory() !== right.isDirectory()) return left.isDirectory() ? -1 : 1;
        return left.name.localeCompare(right.name);
      });

    const nodes = [];
    for (const dirent of dirents) {
      if (entries >= maxEntries) {
        truncated = true;
        break;
      }
      const absolute = path.join(directory, dirent.name);
      const relative = path.relative(path.resolve(root), absolute).replaceAll('\\', '/');
      entries += 1;
      if (dirent.isDirectory()) {
        nodes.push({ path: relative, name: dirent.name, type: 'directory', children: await walk(absolute, depth + 1) });
      } else if (dirent.isFile()) {
        nodes.push({ path: relative, name: dirent.name, type: 'file' });
      }
    }
    return nodes;
  }

  const tree = await walk(path.resolve(root), 0);
  return { tree, truncated };
}

export async function readWorkspaceFile(root, relativePath) {
  const absolute = resolveInsideRoot(root, relativePath);
  const info = await stat(absolute).catch(() => null);
  if (!info?.isFile()) throw new Error(`workspace file not found: ${relativePath}`);
  if (info.size > MAX_FILE_BYTES) throw new Error(`workspace file is too large to open: ${relativePath}`);
  return readFile(absolute, 'utf8');
}

function assertFileContent(content) {
  if (typeof content !== 'string') throw new Error('file content must be a string');
  if (Buffer.byteLength(content, 'utf8') > MAX_FILE_BYTES) throw new Error('file content exceeds the 2 MiB workspace limit');
}

export async function writeWorkspaceFile(root, relativePath, content) {
  assertFileContent(content);
  const absolute = resolveInsideRoot(root, relativePath);
  const info = await stat(absolute).catch(() => null);
  if (!info?.isFile()) throw new Error(`workspace file not found: ${relativePath}`);
  await writeFile(absolute, content, 'utf8');
  return { path: normalizeRelativePath(relativePath), bytes: Buffer.byteLength(content, 'utf8') };
}

export async function createWorkspaceFile(root, relativePath, content = '') {
  assertFileContent(content);
  const absolute = resolveInsideRoot(root, relativePath);
  const existing = await stat(absolute).catch(() => null);
  if (existing) throw new Error(`a file named ${relativePath} already exists`);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, content, 'utf8');
  return { path: normalizeRelativePath(relativePath), bytes: Buffer.byteLength(content, 'utf8') };
}

export async function deleteWorkspaceFile(root, relativePath) {
  const absolute = resolveInsideRoot(root, relativePath);
  const info = await stat(absolute).catch(() => null);
  if (!info?.isFile()) throw new Error(`workspace file not found: ${relativePath}`);
  await unlink(absolute);
  return { path: normalizeRelativePath(relativePath) };
}

// Remembers the last opened folder so the desktop app reopens the same
// workspace on the next launch.
export function createWorkspaceSession({ storeFile } = {}) {
  let root;

  function current() {
    return root ? { path: root, name: path.basename(root) } : null;
  }

  async function persist() {
    if (!storeFile) return;
    await mkdir(path.dirname(storeFile), { recursive: true });
    await writeFile(storeFile, `${JSON.stringify({ root: root ?? null }, null, 2)}\n`, 'utf8');
  }

  return {
    current,
    get root() {
      return root;
    },
    async setRoot(next) {
      if (typeof next !== 'string' || next.trim() === '') throw new Error('a workspace folder is required');
      const resolved = path.resolve(next);
      const info = await stat(resolved).catch(() => null);
      if (!info?.isDirectory()) throw new Error(`workspace folder not found: ${next}`);
      root = resolved;
      await persist();
      return current();
    },
    async clear() {
      root = undefined;
      await persist();
      return null;
    },
    async restore() {
      if (!storeFile) return current();
      const raw = await readFile(storeFile, 'utf8').catch(() => '');
      try {
        const parsed = JSON.parse(raw);
        if (typeof parsed?.root !== 'string') return null;
        const info = await stat(parsed.root).catch(() => null);
        if (!info?.isDirectory()) return null;
        root = path.resolve(parsed.root);
      } catch {
        return null;
      }
      return current();
    },
  };
}