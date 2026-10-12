// Documentation is how this repository explains itself: the READMEs, the handbuch,
// the per-app READMEs and the design notes all point at files around them. A link
// to a file that moved is a reader hitting a dead end, and nothing else notices.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = path.resolve(appRoot, '..', '..');

function markdownFiles() {
  return execFileSync('git', ['ls-files'], { cwd: repositoryRoot, encoding: 'utf8' })
    .split('\n').map((line) => line.trim()).filter((file) => file.endsWith('.md')).sort();
}

test('every relative link in the tracked markdown resolves', () => {
  const files = markdownFiles();
  assert.ok(files.length >= 20, `expected the repository to document itself, saw ${files.length} markdown files`);
  const broken = [];
  let checked = 0;
  for (const file of files) {
    const text = readFileSync(path.join(repositoryRoot, file), 'utf8');
    for (const match of text.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
      const target = match[1].trim();
      // External links, bare anchors and placeholders are not paths.
      if (/^(https?:|mailto:|#|<)/.test(target)) continue;
      const relative = decodeURIComponent(target.split('#')[0].replace(/^<|>$/g, ''));
      if (!relative) continue;
      checked += 1;
      if (!existsSync(path.resolve(path.dirname(path.join(repositoryRoot, file)), relative))) {
        broken.push(`${file} → ${target}`);
      }
    }
  }
  // The two counts guard the walker itself: a parse that finds nothing would pass
  // for the wrong reason.
  assert.ok(checked >= 10, `expected the documentation to link to itself, saw ${checked} relative links`);
  assert.deepEqual(broken, []);
});

test('the index the verification suite relies on is reachable from the READMEs', () => {
  // A contract test elsewhere asserts the root README links it; these are the two
  // pages a person reads while running a check.
  for (const file of ['apps/desktop/README.md', 'apps/web/README.md']) {
    const text = readFileSync(path.join(repositoryRoot, file), 'utf8');
    assert.match(text, /handbuch\/verification\.md/, `${file} has to point at the verification index`);
  }
});

test('every handbook document is linked from somewhere', () => {
  // Four of them had no inbound link at all: the documents existed and nobody could
  // navigate to them from anywhere in the repository.
  const files = markdownFiles();
  const handbook = files.filter((file) => file.startsWith('handbuch/'));
  assert.ok(handbook.length >= 5, `expected the handbook to have documents, saw ${handbook.length}`);

  const inbound = new Set();
  for (const file of files) {
    const text = readFileSync(path.join(repositoryRoot, file), 'utf8');
    for (const match of text.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
      const target = match[1].trim();
      if (/^(https?:|mailto:|#|<)/.test(target)) continue;
      const relative = decodeURIComponent(target.split('#')[0].replace(/^<|>$/g, ''));
      if (!relative) continue;
      const resolved = path.relative(repositoryRoot, path.resolve(path.dirname(path.join(repositoryRoot, file)), relative)).replaceAll('\\', '/');
      if (resolved !== file) inbound.add(resolved);
    }
  }
  const orphaned = handbook.filter((file) => !inbound.has(file));
  assert.deepEqual(orphaned, [], 'a handbook document nobody links to is a document nobody finds');
});