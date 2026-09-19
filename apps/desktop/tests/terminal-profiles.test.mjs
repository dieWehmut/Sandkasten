import assert from 'node:assert/strict';
import test from 'node:test';
import { discoverTerminalProfiles } from '../src/terminal-profiles.mjs';

test('Windows profiles contain only installed shells, prefer PowerShell and retain executable privacy', async () => {
  const installed = new Set([
    'C:\\Windows\\System32\\cmd.exe',
    'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Windows\\System32\\wsl.exe',
  ]);
  const profiles = await discoverTerminalProfiles({
    platform: 'win32', env: { SystemRoot: 'C:\\Windows', ProgramFiles: 'C:\\Program Files' },
    isExecutable: (file) => installed.has(file),
    listWsl: async () => ['Ubuntu'],
  });
  assert.deepEqual(profiles.map(({ id }) => id), ['powershell', 'cmd', 'git-bash', 'wsl']);
  assert.equal(profiles.find(({ isDefault }) => isDefault).id, 'powershell');
  assert.equal(profiles.find(({ id }) => id === 'git-bash').executable, 'C:\\Program Files\\Git\\bin\\bash.exe');
  assert.deepEqual(profiles.find(({ id }) => id === 'git-bash').args, ['--login', '-i']);
});

test('Windows without PowerShell or a WSL distro offers cmd as the default', async () => {
  const profiles = await discoverTerminalProfiles({
    platform: 'win32', env: { SystemRoot: 'C:\\Windows' },
    isExecutable: (file) => file.endsWith('cmd.exe') || file.endsWith('wsl.exe'),
    listWsl: async () => [],
  });
  assert.deepEqual(profiles.map(({ id, isDefault }) => ({ id, isDefault })), [{ id: 'cmd', isDefault: true }]);
});

test('Unix discovers the login shell and available standard shells without duplicates', async () => {
  const profiles = await discoverTerminalProfiles({
    platform: 'linux', env: { SHELL: '/bin/bash' },
    isExecutable: (file) => ['/bin/bash', '/bin/sh'].includes(file),
  });
  assert.deepEqual(profiles.map(({ executable }) => executable), ['/bin/bash', '/bin/sh']);
  assert.equal(profiles[0].isDefault, true);
});
