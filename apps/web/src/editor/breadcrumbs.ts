// Breadcrumb segments for the active file: the reference resolves a path into
// readable steps, and keeping that as plain data lets the tests assert the
// split without mounting the bar. The picker's level lookup lives here too.
import type { WorkspaceTreeNode } from '../services/desktopBridge';
export type BreadcrumbKind = 'root' | 'directory' | 'file';

export interface BreadcrumbSegment {
  /**
   * Path this segment stands for. Directory segments use the same
   * root-relative form as the explorer tree so "reveal" can match a node;
   * the root and the file carry no reveal target.
   */
  path: string;
  name: string;
  kind: BreadcrumbKind;
}

function normalize(path: string): string {
  return String(path ?? '').trim().replace(/\\/g, '/').replace(/\/+$/, '');
}

function isAbsolute(path: string): boolean {
  return path.startsWith('/') || /^[a-z]:\//i.test(path);
}

/**
 * Split an active file path into the steps above it.
 *
 * The desktop bridge reports file paths relative to the opened folder and the
 * folder itself as an absolute path, so the trail leads with the root and then
 * walks the relative segments. An absolute path that falls outside the root
 * keeps its own leading steps rather than pretending to belong to the folder.
 */
export function breadcrumbSegments(filePath: string | undefined | null, rootPath?: string | null): BreadcrumbSegment[] {
  const file = normalize(filePath);
  if (!file) return [];

  const root = normalize(rootPath);
  const insideRoot = Boolean(root) && isAbsolute(file)
    && file.toLowerCase().startsWith(`${root.toLowerCase()}/`);
  if (root && file.toLowerCase() === root.toLowerCase()) return [];

  const relative = insideRoot ? file.slice(root.length + 1) : file;
  const parts = relative.split('/').filter(Boolean);
  if (!parts.length) return [];

  const segments: BreadcrumbSegment[] = [];
  if (root && (!isAbsolute(file) || insideRoot)) {
    segments.push({ path: '', name: root.split('/').filter(Boolean).at(-1) ?? root, kind: 'root' });
  }
  parts.slice(0, -1).forEach((name, index) => {
    segments.push({ path: parts.slice(0, index + 1).join('/'), name, kind: 'directory' });
  });
  segments.push({ path: '', name: parts.at(-1) ?? '', kind: 'file' });
  return segments;
}

/** Collapsed-directory entries that must open for `revealPath` to be visible. */
export function ancestorPaths(path: string | undefined | null): string[] {
  const parts = normalize(path).split('/').filter(Boolean);
  return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join('/'));
}

export interface BreadcrumbEntry {
  path: string;
  name: string;
  kind: 'file' | 'directory';
}

/**
 * The entries of the level `path` sits in, which is what a breadcrumb drops down:
 * the root level for an empty path, or the children of the folder that contains
 * `path`. An unknown path yields no entries rather than a wrong level.
 */
export function siblingEntries(
  tree: readonly WorkspaceTreeNode[],
  path: string | undefined | null,
): BreadcrumbEntry[] {
  const target = normalize(path);
  const nodes = target ? findChildren(tree, target.split('/').slice(0, -1).join('/')) : tree;
  return nodes.map((node) => ({
    path: node.path,
    name: node.name,
    kind: node.type === 'directory' ? 'directory' : 'file',
  }));
}

function findChildren(nodes: readonly WorkspaceTreeNode[], directory: string): readonly WorkspaceTreeNode[] {
  if (!directory) return nodes;
  for (const node of nodes) {
    if (node.type !== 'directory') continue;
    if (node.path === directory) return node.children ?? [];
    const nested = findChildren(node.children ?? [], directory);
    if (nested.length) return nested;
  }
  return [];
}