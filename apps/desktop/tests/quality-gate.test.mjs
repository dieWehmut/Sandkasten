// The quality gate is the repository's strictest entry: it runs the Go and Rust
// suites, the WebUI unit tests, build and artifact contracts, the apps layout, the
// CLI and the desktop shell tests. This resolves what it runs the way the index
// contract resolves the index, so a renamed script or npm entry cannot quietly
// turn the gate into a no-op — the script reports a missing path as a failure, but
// a `cd` into the wrong directory would only show up in CI.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = path.resolve(appRoot, '..', '..');
const gatePath = path.join(repositoryRoot, 'werkzeug', 'quality', 'test.sh');
const indexPath = path.join(repositoryRoot, 'handbuch', 'verification.md');

function gateText() {
  return readFileSync(gatePath, 'utf8');
}

function scriptsOf(app) {
  const manifest = JSON.parse(readFileSync(path.join(repositoryRoot, app, 'package.json'), 'utf8'));
  return new Set(Object.keys(manifest.scripts ?? {}));
}

test('every path the quality gate names exists', () => {
  const referenced = new Set();
  for (const match of gateText().matchAll(/\$ROOT\/([\w./-]+)/g)) referenced.add(match[1]);
  assert.ok(referenced.size >= 5, `expected the gate to reference its pieces, saw ${referenced.size}`);
  const missing = [...referenced].filter((relative) => !existsSync(path.join(repositoryRoot, relative)));
  assert.deepEqual(missing, []);
});

test('every npm script the quality gate runs exists in the app it runs it in', () => {
  const problems = [];
  for (const line of gateText().split(/\r?\n/)) {
    const directory = /\$ROOT\/(apps\/\w+)/.exec(line)?.[1];
    if (!directory) continue;
    for (const match of line.matchAll(/npm (ci|test|run ([\w:.-]+))/g)) {
      if (match[1] === 'ci') continue;
      const script = match[2] ?? 'test';
      if (!scriptsOf(directory).has(script)) problems.push(`${directory}: ${script}`);
    }
  }
  assert.ok(problems.length === 0, `the gate must only run scripts that exist: ${problems.join(', ')}`);
});

test('the index names every step the quality gate takes', () => {
  // The labels are the gate's own, so the prose cannot claim coverage the script
  // does not have, or drop a step it gained.
  const labels = [...gateText().matchAll(/run_or_fail "([^"]+)"/g)].map((match) => match[1]);
  assert.ok(labels.length >= 8, `expected the gate to name its steps, saw ${labels.length}`);
  const index = readFileSync(indexPath, 'utf8');
  const unnamed = labels.filter((label) => !index.includes(label));
  assert.deepEqual(unnamed, [], 'the verification index has to name every step of the gate');
});

test('every check the gate can report missing is one it actually looks for', () => {
  // `missing` and `missing_check` count a missing tool or file as a failure; the
  // hints are what a reader follows, so the paths in them have to be real.
  const hinted = [...gateText().matchAll(/missing_check "\$ROOT\/([\w./-]+)"/g)].map((match) => match[1]);
  assert.ok(hinted.length >= 2, `expected the gate to guard its contracts, saw ${hinted.length}`);
  const missing = hinted.filter((relative) => !existsSync(path.join(repositoryRoot, relative)));
  assert.deepEqual(missing, []);
});

test('the gate keeps Go out of the system temp directory', () => {
  // An MSYS2 or Git Bash shell maps /tmp onto a Windows path whose test binaries Go
  // cannot always remove, and the suite then reports a passing run as a failure.
  const declared = /GOTMPDIR="\$\{GOTMPDIR:-([^}]+)\}"/.exec(gateText())?.[1];
  assert.ok(declared, 'the gate has to set GOTMPDIR rather than leave it to the system');
  assert.match(declared, /^\$ROOT\//, `Go's temporaries belong inside the repository, saw ${declared}`);
});