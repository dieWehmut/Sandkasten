// Git access for the opened folder. Every command runs through execFile with a
// fixed argument vector: the renderer can name files inside the folder and type
// a commit message, but it can never supply a flag, a ref, or a shell string.
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

import { resolveInsideRoot } from './workspace.mjs';

const run = promisify(execFile);
const HISTORY_LIMIT = 50;
// `git log` prints one commit per line; the unit separator divides its fields.
// The decorations, the parent list, and the committer date ride along so the
// graph and its ref badges render without a second git call.
const HISTORY_FORMAT = '%h%x1f%H%x1f%s%x1f%an%x1f%aI%x1f%D%x1f%P%x1f%ct';
const GIT_TIMEOUT_MS = 10_000;

async function git(cwd, args) {
  const { stdout } = await run('git', args, {
    cwd,
    timeout: GIT_TIMEOUT_MS,
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
  });
  return stdout;
}

function normalizeRoot(root) {
  if (typeof root !== 'string' || root.trim() === '') throw new Error('open a workspace folder first');
  return path.resolve(root);
}

function assertCommitMessage(message) {
  if (typeof message !== 'string' || message.trim() === '') throw new Error('a commit message is required');
  if (message.length > 2000) throw new Error('the commit message is too long');
  // A leading dash would be read as an option by git, so it is refused rather
  // than escaped; the same rule covers newlines that would split the message.
  if (message.trimStart().startsWith('-')) throw new Error('a commit message cannot start with a dash');
  if (message.includes('\0')) throw new Error('a commit message cannot contain NUL bytes');
  return message.trim();
}

// One porcelain record may carry two status letters (an index letter and a work
// tree letter), so both are reported and the caller decides what to show.
function parseStatus(stdout) {
  const records = stdout.split('\0');
  const changes = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record || record.length < 3) continue;
    const indexLetter = record[0];
    const worktree = record[1];
    const filePath = record.slice(3);
    if (!filePath) continue;
    const staged = indexLetter !== ' ' && indexLetter !== '?';
    // A rename or copy carries its original path in the next NUL field, which
    // must be consumed so it is never read as a status record of its own.
    const renamed = indexLetter === 'R' || indexLetter === 'C' || worktree === 'R' || worktree === 'C';
    if (renamed) index += 1;
    changes.push({
      path: filePath.replaceAll('\\', '/'),
      index: indexLetter,
      worktree,
      staged,
      status: describeStatus(indexLetter, worktree, staged),
    });
  }
  return changes;
}

function describeStatus(index, worktree, staged) {
  const letters = new Set([index, worktree]);
  if (index === '?' && worktree === '?') return 'untracked';
  if (letters.has('U') || (letters.has('A') && letters.has('D'))) return 'conflicted';
  if (letters.has('R') || letters.has('C')) return 'renamed';
  if (letters.has('D')) return 'deleted';
  return staged ? 'staged' : letters.has('A') ? 'added' : 'modified';
}

export async function readWorkspaceStatus(root) {
  const cwd = normalizeRoot(root);
  try {
    const inside = (await git(cwd, ['rev-parse', '--is-inside-work-tree'])).trim();
    if (inside !== 'true') return emptyStatus();
  } catch {
    // Outside a repository git exits non-zero; the view reports that a folder
    // is open but not tracked instead of showing a failure banner.
    return emptyStatus();
  }

  const branch = await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']).then((value) => value.trim()).catch(() => '');
  const porcelain = await git(cwd, ['status', '--porcelain=v1', '-z']).catch(() => '');
  const changes = parseStatus(porcelain);
  const history = await git(cwd, ['log', '--all', '--topo-order', `--max-count=${HISTORY_LIMIT}`, `--pretty=format:${HISTORY_FORMAT}`])
    .then((stdout) => parseHistory(stdout))
    .catch(() => []);

  return {
    isRepository: true,
    branch,
    changes,
    stagedCount: changes.filter((change) => change.staged).length,
    history,
  };
}

function emptyStatus() {
  return { isRepository: false, branch: '', changes: [], stagedCount: 0, history: [] };
}

// One commit per line, eight unit-separated fields per commit. A NUL separator
// cannot be used here: Node refuses to pass a NUL byte as an argv entry, so the
// whole command would fail and the history would silently stay empty.
function parseHistory(stdout) {
  const entries = [];
  for (const line of stdout.split('\n')) {
    if (!line) continue;
    const [short, full, subject, author, date, decorations, parents, committed] = line.split('\u001f');
    if (!short || !full) continue;
    const decoration = parseDecorations(decorations);
    const entry = {
      short,
      full,
      subject: subject ?? '',
      author: author ?? '',
      date: date ?? '',
      refs: decoration.refs,
      parents: (parents ?? '').split(' ').filter(Boolean),
      committedAt: committed ? Number(committed) * 1000 : 0,
    };
    if (decoration.isHead) entry.isHead = true;
    entries.push(entry);
  }
  return entries;
}

// `%D` prints "HEAD -> main, origin/main, tag: v1" (and is empty for a plain
// commit), so the decorations are normalized to the names alone: the arrow is
// dropped, a tag keeps its `tag: ` marker, and a detached HEAD stays `HEAD`.
// The HEAD marker also tells the graph which dot is the outlined ring.
function parseDecorations(decorations) {
  const value = String(decorations ?? '').trim();
  if (!value) return { refs: [], isHead: false };
  let isHead = false;
  const refs = [];
  for (const raw of value.split(',')) {
    const name = raw.trim();
    if (!name) continue;
    const arrow = name.lastIndexOf(' -> ');
    if (arrow !== -1) {
      isHead = true;
      refs.push(name.slice(arrow + 4).trim());
      continue;
    }
    if (name === 'HEAD') {
      isHead = true;
      continue;
    }
    refs.push(name.replace(/^tag:\s*/, 'tag: '));
  }
  return { refs: refs.filter(Boolean), isHead };
}

export async function stageWorkspaceChanges(root, paths) {
  const cwd = normalizeRoot(root);
  if (!Array.isArray(paths) || paths.length === 0) throw new Error('at least one file must be staged');
  // Resolving each path inside the root rejects anything that escapes, and the
  // relative form guarantees no argument can start with a dash.
  const relative = paths.map((entry) => {
    resolveInsideRoot(cwd, entry);
    return path.relative(cwd, path.resolve(cwd, String(entry).replaceAll('\\', '/'))).replaceAll('\\', '/');
  });
  await git(cwd, ['add', '--', ...relative]);
  return { staged: relative };
}

export async function commitWorkspaceChanges(root, message) {
  const cwd = normalizeRoot(root);
  const subject = assertCommitMessage(message);
  try {
    await git(cwd, ['commit', '-m', subject]);
  } catch (error) {
    const stderr = String(error?.stderr ?? error?.message ?? '');
    if (/nothing to commit/i.test(stderr)) throw new Error('nothing is staged to commit');
    throw new Error(stderr.trim() || 'git commit failed');
  }
  return { committed: true };
}
