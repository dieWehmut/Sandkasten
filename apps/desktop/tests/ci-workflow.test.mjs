// The verify workflow has to call things that exist: this repository has no YAML
// dependency, so the file is read as text and every command it runs is resolved
// against the package.json it names. A workflow that drifts from the scripts is
// a red build nobody asked for.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = path.resolve(appRoot, '..', '..');
const workflowPath = path.join(repositoryRoot, '.github', 'workflows', 'verify.yml');

function workflowText() {
  return readFileSync(workflowPath, 'utf8');
}

// `working-directory:` applies to the steps after it until it changes again, and
// a `run:` step is either one line or a block of them.
function steps() {
  const found = [];
  let directory = repositoryRoot;
  let block;
  const capture = (text) => {
    const command = /^npm\s+(ci|test|run\s+[\w:.-]+)$/.exec(text.trim());
    if (command) found.push({ directory, command: `npm ${command[1]}` });
    const script = /^bash\s+(\S+)/.exec(text.trim());
    if (script) found.push({ directory, command: `bash ${script[1]}` });
  };
  for (const line of workflowText().split(/\r?\n/)) {
    const working = /^\s+working-directory:\s*(\S+)\s*$/.exec(line);
    if (working) {
      directory = path.resolve(repositoryRoot, working[1]);
      block = undefined;
      continue;
    }
    const run = /^(\s+)run:\s*(.*)$/.exec(line);
    if (run) {
      if (['|', '>'].includes(run[2].trim())) block = { indent: run[1].length };
      else {
        capture(run[2]);
        block = undefined;
      }
      continue;
    }
    if (!block) continue;
    const indented = /^(\s*)(\S.*)$/.exec(line);
    if (!indented || indented[1].length <= block.indent) {
      block = undefined;
      continue;
    }
    capture(indented[2]);
  }
  return found;
}

function manifest(directory) {
  return JSON.parse(readFileSync(path.join(directory, 'package.json'), 'utf8'));
}

test('the verify workflow exists with the pinned toolchain', () => {
  assert.equal(existsSync(workflowPath), true, 'the verify workflow must exist');
  const text = workflowText();
  assert.match(text, /^name: Verify$/m);
  assert.match(text, /runs-on: ubuntu-latest/);
  // The same Node major the Pages workflow and both engines fields require.
  assert.match(text, /node-version: 22\.18\.0/);
  assert.match(text, /on:\n\s+push:\n\s+branches:\n\s+- main\n\s+pull_request:/);
});

test('every command the workflow runs is a script of the directory it runs in', () => {
  const commands = steps().filter((step) => step.command.startsWith('npm '));
  assert.ok(commands.length >= 4, `the workflow should run several commands, saw ${commands.length}`);
  const directories = new Set(commands.map((step) => step.directory));
  assert.deepEqual([...directories].sort().map((directory) => path.relative(repositoryRoot, directory).replaceAll('\\', '/')),
    ['apps/cli', 'apps/desktop', 'apps/web']);

  for (const { directory, command } of commands) {
    const name = path.relative(repositoryRoot, directory);
    assert.equal(existsSync(path.join(directory, 'package.json')), true, `${name} must be a package`);
    if (command === 'npm ci') {
      assert.equal(existsSync(path.join(directory, 'package-lock.json')), true, `${name} must lock its dependencies for npm ci`);
      continue;
    }
    const script = command === 'npm test' ? 'test' : command.replace(/^npm run\s+/, '');
    assert.ok(manifest(directory).scripts?.[script], `${name} must define the ${script} script`);
  }
});

test('every shell script the workflow runs exists in the repository', () => {
  const scripts = steps().filter((step) => step.command.startsWith('bash ')).map((step) => step.command.slice('bash '.length));
  assert.ok(scripts.includes('scripts/webui-build-test.sh'), `the workflow must check the committed distribution, saw: ${scripts.join(', ') || 'none'}`);
  for (const script of scripts) {
    assert.equal(existsSync(path.join(repositoryRoot, script)), true, `${script} must exist`);
  }
});

test('the workflow runs the machine checks, not just the unit suites', () => {
  const machine = steps().filter((step) => step.command === 'npm run verify');
  assert.deepEqual(machine.map((step) => path.relative(repositoryRoot, step.directory).replaceAll('\\', '/')), ['apps/desktop']);
  assert.ok(manifest(path.join(repositoryRoot, 'apps', 'desktop')).scripts?.verify, 'npm run verify must exist');
  assert.match(workflowText(), /unavailable/, 'the workflow must say how an absent backend is reported');
});

test('the workflow drives the built WebUI in a real browser', () => {
  const webui = steps()
    .filter((step) => path.basename(step.directory) === 'web' && step.command.startsWith('npm '))
    .map((step) => step.command);
  assert.ok(
    webui.includes('npm run test:browser'),
    `the WebUI steps must include the browser smoke, saw: ${webui.join(', ') || 'none'}`,
  );
  assert.ok(manifest(path.join(repositoryRoot, 'apps', 'web')).scripts?.['test:browser']);
});