import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createIgnoreMatcher, parseGitignore } from '../src/gitignore.mjs';
import { listWorkspaceTree } from '../src/workspace.mjs';

async function temporaryDirectory(prefix) {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

// `.gitignore` semantics taken from git's own documentation: comments, negation,
// directory-only patterns, anchoring, `**`, and character classes.
test('parses the gitignore rules the Explorer needs', () => {
  const rules = parseGitignore([
    '# a comment',
    '',
    'node_modules',
    'build/',
    '/dist',
    '*.log',
    '!keep.log',
    'docs/**/*.tmp',
    'file?.txt',
    '[abc].cfg',
    'sub/anchored.py',
  ].join('\n'));

  assert.equal(rules.length, 9);
  assert.deepEqual(rules.map((rule) => rule.negated), [false, false, false, false, true, false, false, false, false]);
  assert.deepEqual(rules.map((rule) => rule.directoryOnly), [false, true, false, false, false, false, false, false, false]);
  // `/dist` is anchored, `*.log` is not, `docs/**/*.tmp` is (it contains a
  // separator), and `sub/anchored.py` is.
  assert.deepEqual(rules.map((rule) => rule.anchored), [false, false, true, false, false, true, false, false, true]);
});

test('a pattern with no slash matches at any depth', () => {
  const isIgnored = createIgnoreMatcher([{ directory: '', rules: parseGitignore('node_modules\n*.log') }]);
  assert.equal(isIgnored('node_modules', true), true);
  assert.equal(isIgnored('packages/app/node_modules', true), true);
  assert.equal(isIgnored('packages/app/debug.log'), true);
  assert.equal(isIgnored('app.py'), false);
});

test('an anchored pattern only matches from its own directory', () => {
  const isIgnored = createIgnoreMatcher([{ directory: '', rules: parseGitignore('/dist\nsub/anchored.py') }]);
  assert.equal(isIgnored('dist', true), true);
  assert.equal(isIgnored('nested/dist', true), false);
  assert.equal(isIgnored('sub/anchored.py'), true);
  // The same file name elsewhere is not matched by the anchored pattern.
  assert.equal(isIgnored('other/anchored.py'), false);
});

test('a directory-only pattern leaves files of that name alone', () => {
  const isIgnored = createIgnoreMatcher([{ directory: '', rules: parseGitignore('build/') }]);
  assert.equal(isIgnored('build', true), true);
  // A *directory* named build is ignored at any depth, a file of that name is not.
  assert.equal(isIgnored('src/build', true), true);
  assert.equal(isIgnored('build.py', false), false);
});

test('a directory rule covers everything beneath it', () => {
  const isIgnored = createIgnoreMatcher([{ directory: '', rules: parseGitignore('dist/') }]);
  assert.equal(isIgnored('dist/index.js'), true);
  assert.equal(isIgnored('dist/deep/nested/file.js'), true);
});

test('negation re-includes, and the last matching rule wins', () => {
  const isIgnored = createIgnoreMatcher([{ directory: '', rules: parseGitignore('*.log\n!keep.log') }]);
  assert.equal(isIgnored('debug.log'), true);
  assert.equal(isIgnored('keep.log'), false);

  // Order matters: a later ignore beats an earlier negation.
  const reversed = createIgnoreMatcher([{ directory: '', rules: parseGitignore('!keep.log\n*.log') }]);
  assert.equal(reversed('keep.log'), true);
});

test('`**` spans directories, `?` and classes match one character', () => {
  const isIgnored = createIgnoreMatcher([{
    directory: '',
    rules: parseGitignore('docs/**/*.tmp\nfile?.txt\n[abc].cfg'),
  }]);
  assert.equal(isIgnored('docs/a.tmp'), true);
  assert.equal(isIgnored('docs/x/y/a.tmp'), true);
  assert.equal(isIgnored('file1.txt'), true);
  assert.equal(isIgnored('file12.txt'), false);
  assert.equal(isIgnored('b.cfg'), true);
  assert.equal(isIgnored('d.cfg'), false);
});

test('a nested .gitignore only governs its own subtree', () => {
  const isIgnored = createIgnoreMatcher([
    { directory: '', rules: parseGitignore('*.log') },
    { directory: 'packages/app', rules: parseGitignore('local.cfg') },
  ]);
  assert.equal(isIgnored('packages/app/local.cfg'), true);
  assert.equal(isIgnored('packages/other/local.cfg'), false);
  // The root rule still applies inside the deeper directory.
  assert.equal(isIgnored('packages/app/debug.log'), true);
});

test('the tree marks ignored entries and keeps them by default', async () => {
  const root = await temporaryDirectory('gitignore-mark-');
  try {
    await mkdir(path.join(root, 'src'));
    await mkdir(path.join(root, 'node_modules', 'left-pad'), { recursive: true });
    await writeFile(path.join(root, '.gitignore'), 'node_modules\n*.log\ndist/\n');
    await writeFile(path.join(root, 'main.py'), 'print(1)\n');
    await writeFile(path.join(root, 'debug.log'), 'noise\n');
    await writeFile(path.join(root, 'src', 'app.py'), 'x = 1\n');
    await writeFile(path.join(root, 'src', 'trace.log'), 'more noise\n');

    const { tree } = await listWorkspaceTree(root);
    const byPath = new Map();
    const walk = (nodes) => {
      for (const node of nodes ?? []) {
        byPath.set(node.path, node);
        if (node.children) walk(node.children);
      }
    };
    walk(tree);

    // The reference's default: the entry is present and flagged, not removed.
    assert.equal(byPath.get('debug.log')?.ignored, true);
    assert.equal(byPath.get('src/trace.log')?.ignored, true, 'a root rule reaches into subdirectories');
    assert.equal(byPath.get('main.py')?.ignored, undefined);
    assert.equal(byPath.get('src/app.py')?.ignored, undefined);
    // node_modules is already hidden by the built-in directory list.
    assert.equal(byPath.has('node_modules'), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('excludeGitIgnore removes the ignored entries instead', async () => {
  const root = await temporaryDirectory('gitignore-exclude-');
  try {
    await mkdir(path.join(root, 'src'));
    await writeFile(path.join(root, '.gitignore'), '*.log\n');
    await writeFile(path.join(root, 'main.py'), 'print(1)\n');
    await writeFile(path.join(root, 'debug.log'), 'noise\n');
    await writeFile(path.join(root, 'src', 'trace.log'), 'noise\n');
    await writeFile(path.join(root, 'src', 'app.py'), 'x = 1\n');

    const { tree } = await listWorkspaceTree(root, { excludeGitIgnore: true });
    const paths = [];
    const walk = (nodes) => {
      for (const node of nodes ?? []) {
        paths.push(node.path);
        if (node.children) walk(node.children);
      }
    };
    walk(tree);

    // `src` survives — only the ignored file inside it is gone, so the folder keeps
    // its one real child rather than disappearing with it.
    assert.deepEqual(paths.sort(), ['.gitignore', 'main.py', 'src', 'src/app.py'].sort());
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a negation keeps a re-included file in the tree', async () => {
  const root = await temporaryDirectory('gitignore-negate-');
  try {
    await writeFile(path.join(root, '.gitignore'), '*.log\n!keep.log\n');
    await writeFile(path.join(root, 'drop.log'), 'noise\n');
    await writeFile(path.join(root, 'keep.log'), 'wanted\n');

    const { tree } = await listWorkspaceTree(root, { excludeGitIgnore: true });
    const names = tree.map((node) => node.name).sort();
    assert.deepEqual(names, ['.gitignore', 'keep.log']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a workspace with no .gitignore marks nothing', async () => {
  const root = await temporaryDirectory('gitignore-none-');
  try {
    await writeFile(path.join(root, 'main.py'), 'print(1)\n');
    const { tree } = await listWorkspaceTree(root);
    assert.equal(tree.length, 1);
    assert.equal(tree[0].ignored, undefined);
    // Excluding changes nothing when there is nothing to exclude.
    const excluded = await listWorkspaceTree(root, { excludeGitIgnore: true });
    assert.deepEqual(excluded.tree.map((node) => node.name), ['main.py']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
