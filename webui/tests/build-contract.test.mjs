import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import test from 'node:test';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const webuiDirectory = resolve(testDirectory, '..');
const repositoryRoot = resolve(webuiDirectory, '..');
const distributionDirectory = resolve(webuiDirectory, 'dist');
const expectedFiles = ['app.js', 'config.js', 'index.html', 'styles.css'];
const expectedTrackedFiles = expectedFiles.map((fileName) => `webui/dist/${fileName}`);
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: process.env,
    shell: process.platform === 'win32' && command.endsWith('.cmd'),
  });

  assert.equal(
    result.status,
    0,
    [
      `${command} ${args.join(' ')} failed`,
      result.error?.message,
      result.stdout,
      result.stderr,
    ].filter(Boolean).join('\n'),
  );
  return result.stdout;
}

function assertRegularFile(fileName) {
  const filePath = resolve(distributionDirectory, fileName);
  assert.equal(existsSync(filePath), true, `${fileName} must exist`);
  assert.equal(lstatSync(filePath).isFile(), true, `${fileName} must be a regular file`);
}

test('a clean production build emits exactly four regular runtime files', { timeout: 120_000 }, () => {
  if (process.env.SANDKASTEN_BUILD_ALREADY_RUN !== '1') {
    run(npmCommand, ['ci'], webuiDirectory);
    run(npmCommand, ['run', 'build'], webuiDirectory);
  }

  assert.deepEqual(readdirSync(distributionDirectory).sort(), expectedFiles);
  for (const fileName of expectedFiles) assertRegularFile(fileName);
});

test('built index loads runtime config before the Vue module', () => {
  const index = readFileSync(resolve(distributionDirectory, 'index.html'), 'utf8');
  const configPosition = index.indexOf('src="./config.js"');
  const appPosition = index.indexOf('src="./app.js"');
  assert.notEqual(configPosition, -1, 'index.html must reference config.js');
  assert.notEqual(appPosition, -1, 'index.html must reference app.js');
  assert.ok(configPosition < appPosition, 'config.js must load before app.js');
});

test('production dist has no nested files, source maps, lockfiles, tests, or symlinks', () => {
  const entries = readdirSync(distributionDirectory, { withFileTypes: true });
  assert.equal(entries.every((entry) => entry.isFile() && !entry.isSymbolicLink()), true);
  assert.equal(entries.some((entry) => /(?:\.map|package-lock|test)/i.test(entry.name)), false);
});

test('source config keeps nullish same-origin semantics', () => {
  const source = readFileSync(resolve(webuiDirectory, 'public', 'config.js'), 'utf8').trim();
  assert.equal(source, "globalThis.SANDKASTEN_CONFIG ??= { apiBaseUrl: '' };");
});

test('the generated installer payload is tracked and fresh', () => {
  const tracked = run('git', ['ls-files', 'webui/dist/*'], repositoryRoot)
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .sort();
  assert.deepEqual(tracked, expectedTrackedFiles);
  run('git', ['diff', '--quiet', '--', 'webui/dist'], repositoryRoot);
});
