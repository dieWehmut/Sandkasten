import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { commitWorkspaceChanges, readWorkspaceStatus, stageWorkspaceChanges } from '../src/source-control.mjs';

const run = promisify(execFile);

async function git(cwd, args) {
  await run('git', ['-c', 'user.email=test@example.com', '-c', 'user.name=Sandkasten Test', ...args], { cwd });
}

async function repository(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sandkasten-git-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await git(root, ['init', '--initial-branch=main']);
  await writeFile(path.join(root, 'tracked.py'), 'print("first")\n');
  await git(root, ['add', '.']);
  await git(root, ['commit', '-m', 'first commit']);
  return root;
}

test('status reports the branch, grouped changes, and the recent log', async (t) => {
  const root = await repository(t);
  await writeFile(path.join(root, 'tracked.py'), 'print("changed")\n');
  await writeFile(path.join(root, 'untracked.py'), 'print("new")\n');
  await mkdir(path.join(root, 'pkg'));
  await writeFile(path.join(root, 'pkg', 'staged.py'), 'print("staged")\n');
  await git(root, ['add', 'pkg/staged.py']);

  const status = await readWorkspaceStatus(root);
  assert.equal(status.isRepository, true);
  assert.equal(status.branch, 'main');
  assert.equal(status.error, undefined);
  const byPath = Object.fromEntries(status.changes.map((change) => [change.path, change.status]));
  assert.equal(byPath['tracked.py'], 'modified');
  assert.equal(byPath['untracked.py'], 'untracked');
  assert.equal(byPath['pkg/staged.py'], 'staged');
  assert.equal(status.changes.find((change) => change.path === 'pkg/staged.py').staged, true);
  assert.equal(status.changes.find((change) => change.path === 'tracked.py').staged, false);
  assert.equal(status.stagedCount, 1);
  assert.deepEqual(status.history.map((entry) => entry.subject), ['first commit']);
  assert.match(status.history[0].short, /^[0-9a-f]{7}$/);
});

test('staging and committing round-trip through a real repository', async (t) => {
  const root = await repository(t);
  await writeFile(path.join(root, 'tracked.py'), 'print("second")\n');

  await stageWorkspaceChanges(root, ['tracked.py']);
  let status = await readWorkspaceStatus(root);
  assert.equal(status.changes.find((change) => change.path === 'tracked.py').staged, true);

  const committed = await commitWorkspaceChanges(root, 'second commit');
  assert.equal(committed.committed, true);
  status = await readWorkspaceStatus(root);
  assert.equal(status.changes.length, 0);
  assert.deepEqual(status.history.map((entry) => entry.subject), ['second commit', 'first commit']);
});

test('history carries the graph fields the reference view draws', async (t) => {
  const root = await repository(t);
  await writeFile(path.join(root, 'tracked.py'), 'print("second")\n');
  await git(root, ['add', '.']);
  await git(root, ['commit', '-m', 'second commit']);
  // A side branch makes the log non-linear, which is what a graph has to show.
  await git(root, ['checkout', '-b', 'topic', 'HEAD~1']);
  await writeFile(path.join(root, 'tracked.py'), 'print("topic")\n');
  await git(root, ['add', '.']);
  await git(root, ['commit', '-m', 'topic commit']);
  await git(root, ['checkout', 'main']);

  const status = await readWorkspaceStatus(root);
  const bySubject = Object.fromEntries(status.history.map((entry) => [entry.subject, entry]));

  // The log spans every branch so the lanes are real, and the commit HEAD points
  // at is marked wherever it sorts rather than assumed to be the first row.
  assert.equal(bySubject['second commit'].isHead, true);
  assert.equal(bySubject['topic commit'].isHead, undefined);
  // Every commit names its parents so the view can draw the lanes without
  // asking git again, and a root commit names none.
  assert.equal(bySubject['topic commit'].parents.length, 1);
  assert.deepEqual(bySubject['first commit'].parents, []);

  // Decorations name the refs that point at a commit, which is what the
  // reference prints beside the tip.
  assert.ok(bySubject['second commit'].refs.includes('main'), 'the HEAD commit must carry its branch decoration: ' + JSON.stringify(bySubject['second commit'].refs));
  assert.ok(bySubject['topic commit'].refs.includes('topic'));

  // The view needs the author, the date, and the short hash for the row.
  assert.equal(typeof bySubject['second commit'].author, 'string');
  assert.equal(typeof bySubject['second commit'].date, 'string');
  assert.match(bySubject['second commit'].short, /^[0-9a-f]{7}$/);
  // Every commit is stamped so the row can show how long ago it landed.
  assert.equal(typeof bySubject['second commit'].committedAt, 'number');
});

test('a rename keeps its original path out of the status list', async (t) => {
  const root = await repository(t);
  await git(root, ['mv', 'tracked.py', 'renamed.py']);

  const status = await readWorkspaceStatus(root);
  // The rename owns two NUL fields (the new path, then the old one); the old
  // path must be consumed by that record instead of read as a change of its own.
  assert.deepEqual(status.changes.map((change) => change.path), ['renamed.py']);
  assert.equal(status.changes[0].status, 'renamed');
});

test('a folder that is not a repository reports that instead of failing', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sandkasten-plain-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  const status = await readWorkspaceStatus(root);
  assert.equal(status.isRepository, false);
  assert.deepEqual(status.changes, []);
  assert.deepEqual(status.history, []);
  await assert.rejects(() => commitWorkspaceChanges(root, 'nope'), /not a git repository/i);
});

test('renderer input can never smuggle a git flag or an empty commit message', async (t) => {
  const root = await repository(t);
  await writeFile(path.join(root, 'tracked.py'), 'print("third")\n');
  await stageWorkspaceChanges(root, ['tracked.py']);

  // The paths are validated against the open folder, and the message is passed
  // as a single argument, so a leading dash can never become a git option.
  await assert.rejects(() => stageWorkspaceChanges(root, ['../escape.py']), /workspace/i);
  await assert.rejects(() => stageWorkspaceChanges(root, []), /at least one file/i);
  await assert.rejects(() => commitWorkspaceChanges(root, '   '), /commit message/i);
  await assert.rejects(() => commitWorkspaceChanges(root, '--amend'), /commit message/i);
});
