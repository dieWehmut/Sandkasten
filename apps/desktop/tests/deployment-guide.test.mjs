// The deployment guide tells an operator which flags to type. A flag the
// installer does not parse is a failed deployment with a confusing error, and a
// documented mode that no longer exists is the same. This resolves the guide's
// installer and dev-up commands against the scripts that parse them.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = path.resolve(appRoot, '..', '..');
const guidePath = path.join(repositoryRoot, 'handbuch', 'deployment.md');
const installerPath = path.join(repositoryRoot, 'werkzeug', 'installer', 'entrypoint.sh');
const installerLibPath = path.join(repositoryRoot, 'werkzeug', 'installer', 'lib.sh');
const devUpPath = path.join(repositoryRoot, 'werkzeug', 'development', 'dev-up.sh');

function read(file) {
  return readFileSync(file, 'utf8');
}

/** The flags a script mentions in its own argument handling. */
function declaredFlags(source) {
  return new Set([...source.matchAll(/(--[a-z][a-z-]*)/g)].map((match) => match[1]));
}

test('every installer flag the deployment guide names is one the installer parses', () => {
  const declared = declaredFlags(read(installerPath));
  const documented = [...read(guidePath).matchAll(/install\.sh([^\n`]*)/g)]
    .flatMap((match) => [...match[1].matchAll(/(--[a-z][a-z-]*)/g)].map((flag) => flag[1]));
  assert.ok(documented.length >= 4, `expected the guide to document installer flags, saw ${documented.length}`);
  const unknown = [...new Set(documented)].filter((flag) => !declared.has(flag));
  assert.deepEqual(unknown, [], 'the guide may only name flags the installer accepts');
});

test('every dev-up flag the deployment guide names is one dev-up parses', () => {
  const declared = declaredFlags(read(devUpPath));
  const documented = [...read(guidePath).matchAll(/dev-up\.sh([^\n`]*)/g)]
    .flatMap((match) => [...match[1].matchAll(/(--[a-z][a-z-]*)/g)].map((flag) => flag[1]));
  assert.ok(documented.length >= 1, `expected the guide to document dev-up flags, saw ${documented.length}`);
  const unknown = [...new Set(documented)].filter((flag) => !declared.has(flag));
  assert.deepEqual(unknown, []);
});

test('the modes the guide documents are the modes the installer accepts', () => {
  const lib = read(installerLibPath);
  const accepted = /cli\|webui\)/.test(lib) || /webui\|cli\)/.test(lib);
  assert.equal(accepted, true, 'the installer has to accept exactly the documented modes');
  const documented = [...new Set([...read(guidePath).matchAll(/--mode ([\w|]+)/g)].map((match) => match[1]))];
  assert.ok(documented.length > 0);
  for (const value of documented) {
    for (const mode of value.split('|')) assert.ok(['cli', 'webui'].includes(mode), `${mode} is not a mode the installer accepts`);
  }
});