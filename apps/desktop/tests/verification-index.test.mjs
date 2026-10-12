// The verification index is only useful while it is true: a renamed script or a
// dropped npm entry turns it into a page of commands that do not run. This test
// resolves every command it lists against the repository, the same way the
// workflow contract resolves the workflow's.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = path.resolve(appRoot, '..', '..');
const indexPath = path.join(repositoryRoot, 'handbuch', 'verification.md');
const APPS = ['apps/web', 'apps/desktop', 'apps/cli'];

function indexText() {
  return readFileSync(indexPath, 'utf8');
}

function scriptsOf(app) {
  const manifest = JSON.parse(readFileSync(path.join(repositoryRoot, app, 'package.json'), 'utf8'));
  return new Set(Object.keys(manifest.scripts ?? {}));
}

function makeTargets() {
  return new Set([...readFileSync(path.join(repositoryRoot, 'Makefile'), 'utf8').matchAll(/^([a-z][\w-]*):/gm)].map((match) => match[1]));
}

test('the verification index exists and the README points at it', () => {
  assert.equal(existsSync(indexPath), true, 'handbuch/verification.md must exist');
  assert.match(readFileSync(path.join(repositoryRoot, 'README.md'), 'utf8'), /handbuch\/verification\.md/,
    'the README test section has to point at the index');
});

test('every make target the index names exists in the Makefile', () => {
  const targets = makeTargets();
  const named = [...indexText().matchAll(/`make ([\w-]+)`/g)].map((match) => match[1]);
  assert.ok(named.length >= 3, `expected the index to name make targets, saw ${named.length}`);
  const missing = [...new Set(named)].filter((target) => !targets.has(target));
  assert.deepEqual(missing, []);
});

test('every npm script the index names exists in the app it names', () => {
  const scripts = Object.fromEntries(APPS.map((app) => [app, scriptsOf(app)]));
  const problems = [];
  for (const line of indexText().split(/\r?\n/)) {
    if (!line.includes('|')) continue;
    const directory = /`cd (apps\/\w+)/.exec(line)?.[1];
    for (const match of line.matchAll(/`([^`]*\bnpm (?:run )?[\w:.-]+)/g)) {
      const command = /\bnpm (?:run )?([\w:.-]+)/.exec(match[1]);
      if (!command) continue;
      const [, script] = command;
      // `npm ci` and `npm install` are commands, not entries in a manifest.
      if (['ci', 'install'].includes(script)) continue;
      const candidates = directory ? [directory] : APPS;
      if (!candidates.some((app) => scripts[app]?.has(script))) problems.push(`${script} (${candidates.join(' or ')})`);
    }
  }
  assert.deepEqual([...new Set(problems)], []);
});

test('every path the index names exists', () => {
  const text = indexText();
  const candidates = new Set();
  for (const match of text.matchAll(/`((?:scripts|werkzeug|laeufer|schnittstelle|handbuch|apps)\/[\w./-]+)/g)) candidates.add(match[1]);
  for (const match of text.matchAll(/\bnode ([\w./-]+\.mjs)/g)) candidates.add(match[1]);
  for (const match of text.matchAll(/`cd ([\w./-]+)/g)) candidates.add(match[1]);
  // The contract tests the index names, without a path in front of them.
  for (const match of text.matchAll(/`([\w-]+\.test\.mjs)`/g)) candidates.add(`apps/desktop/tests/${match[1]}`);
  assert.ok(candidates.size >= 8, `expected the index to name paths, saw ${candidates.size}`);
  const missing = [...candidates].filter((candidate) => !existsSync(path.join(repositoryRoot, candidate)));
  assert.deepEqual(missing, []);
});

test('every test that guards a document is named in the index', () => {
  // A contract nobody can find is a contract nobody reads: a test that reads the
  // handbuch or a README to check it has to be listed here.
  const testsDirectory = path.join(repositoryRoot, 'apps', 'desktop', 'tests');
  const guarders = readdirSync(testsDirectory)
    .filter((file) => file.endsWith('.test.mjs'))
    .filter((file) => /handbuch|README/.test(readFileSync(path.join(testsDirectory, file), 'utf8')))
    .sort();
  assert.ok(guarders.length >= 4, `expected document guards in the suite, saw ${guarders.length}`);

  const index = indexText();
  const unnamed = guarders.filter((file) => !index.includes(file));
  assert.deepEqual(unnamed, [], 'a document guard has to be listed in the verification index');
});