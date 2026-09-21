// Text search across the folder the user opened. It walks the same guarded
// tree as the explorer: heavy directories are skipped, symbolic links are never
// followed, and both the result list and each file stay bounded so a huge
// folder cannot stall the window.
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { IGNORED_DIRECTORIES, MAX_TREE_DEPTH } from './workspace.mjs';

export const MAX_SEARCH_FILE_BYTES = 512 * 1024;
export const MAX_SEARCH_FILES = 400;
export const MAX_SEARCH_MATCHES = 200;
export const MAX_MATCHES_PER_FILE = 20;

function assertQuery(query) {
  if (typeof query !== 'string' || query.trim() === '') throw new Error('a workspace search query is required');
  if (query.length > 200) throw new Error('the workspace search query is too long');
  return query;
}

async function readDirectory(directory) {
  return readdir(directory, { withFileTypes: true }).catch((error) => {
    if (error?.code === 'ENOENT') return [];
    throw error;
  });
}

export async function searchWorkspaceFiles(root, query, options = {}) {
  const needle = assertQuery(query);
  const caseSensitive = options.caseSensitive === true;
  const maxMatches = Number.isInteger(options.maxMatches) ? options.maxMatches : MAX_SEARCH_MATCHES;
  const ignored = options.ignored ?? IGNORED_DIRECTORIES;
  const resolvedRoot = path.resolve(root);
  const rootStats = await stat(resolvedRoot).catch(() => null);
  if (!rootStats?.isDirectory()) throw new Error(`workspace folder not found: ${root}`);

  const haystack = caseSensitive ? needle : needle.toLowerCase();
  const files = [];
  let matchCount = 0;
  let truncated = false;

  async function collect(directory, depth) {
    if (depth > MAX_TREE_DEPTH || files.length >= MAX_SEARCH_FILES) {
      truncated = files.length >= MAX_SEARCH_FILES;
      return;
    }
    const dirents = (await readDirectory(directory))
      .filter((entry) => !entry.isSymbolicLink())
      .filter((entry) => !(entry.isDirectory() && ignored.has(entry.name)))
      .sort((left, right) => left.name.localeCompare(right.name));

    for (const dirent of dirents) {
      if (files.length >= MAX_SEARCH_FILES) {
        truncated = true;
        return;
      }
      const absolute = path.join(directory, dirent.name);
      if (dirent.isDirectory()) {
        await collect(absolute, depth + 1);
        continue;
      }
      if (!dirent.isFile()) continue;
      const info = await stat(absolute).catch(() => null);
      if (!info || info.size > MAX_SEARCH_FILE_BYTES) continue;
      const buffer = await readFile(absolute).catch(() => null);
      // A NUL byte in the first block means a binary payload, not source text.
      if (!buffer || buffer.subarray(0, 8000).includes(0)) continue;
      const source = buffer.toString('utf8');
      const matches = [];
      const lines = source.split(/\r?\n/);
      for (let index = 0; index < lines.length; index += 1) {
        const text = lines[index];
        const candidate = caseSensitive ? text : text.toLowerCase();
        if (!candidate.includes(haystack)) continue;
        matches.push({ line: index + 1, text: text.trim() });
        if (matches.length >= MAX_MATCHES_PER_FILE) break;
      }
      if (!matches.length) continue;
      // The cap counts results, not files: a file may only contribute the
      // matches that still fit, and the run reports that it cut them off.
      if (matchCount + matches.length > maxMatches) {
        matches.length = Math.max(0, maxMatches - matchCount);
        truncated = true;
      }
      matchCount += matches.length;
      if (matches.length) {
        files.push({
          path: path.relative(resolvedRoot, absolute).replaceAll('\\', '/'),
          name: dirent.name,
          matches,
        });
      }
      if (truncated) return;
    }
  }

  await collect(resolvedRoot, 0);
  // A stable path order keeps repeated searches comparable for the reader.
  files.sort((left, right) => left.path.localeCompare(right.path));

  return {
    query: needle,
    caseSensitive,
    files,
    fileCount: files.length,
    matchCount,
    truncated,
  };
}
