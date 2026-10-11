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

test('every Windows shell profile carries the directories that hold its own commands', async () => {
  const installed = new Set([
    'C:\\Users\\dev\\AppData\\Local\\Microsoft\\WindowsApps\\pwsh.exe',
    'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    'C:\\Windows\\System32\\cmd.exe',
    'D:\\software\\git\\Git\\usr\\bin\\bash.exe',
    'D:\\software\\msys\\msys2\\usr\\bin\\bash.exe',
    'C:\\Windows\\System32\\wsl.exe',
  ]);
  const profiles = await discoverTerminalProfiles({
    platform: 'win32',
    env: {
      SystemRoot: 'C:\\Windows', LOCALAPPDATA: 'C:\\Users\\dev\\AppData\\Local',
      PATH: 'C:\\Windows\\System32;D:\\software\\git\\Git\\cmd;D:\\software\\msys\\msys2\\usr\\bin',
    },
    isExecutable: (file) => installed.has(file),
    listWsl: async () => ['Debian'],
  });
  assert.deepEqual(profiles.map(({ id }) => id), ['powershell', 'windows-powershell', 'cmd', 'git-bash', 'msys2', 'wsl']);
  assert.equal(profiles.find(({ id }) => id === 'powershell').executable,
    'C:\\Users\\dev\\AppData\\Local\\Microsoft\\WindowsApps\\pwsh.exe');
  assert.deepEqual(profiles.find(({ id }) => id === 'powershell').pathPrepend,
    ['C:\\Users\\dev\\AppData\\Local\\Microsoft\\WindowsApps']);
  assert.equal(profiles.find(({ id }) => id === 'cmd').pathPrepend.length, 0);
  // A Git for Windows install keeps git, ls, sed and ssh beside the shell.
  const gitBash = profiles.find(({ id }) => id === 'git-bash');
  assert.equal(gitBash.executable, 'D:\\software\\git\\Git\\usr\\bin\\bash.exe');
  assert.deepEqual(gitBash.pathPrepend,
    ['D:\\software\\git\\Git\\usr\\bin', 'D:\\software\\git\\Git\\mingw64\\bin', 'D:\\software\\git\\Git\\clang64\\bin']);
  // The MSYS2 install is discovered from the PATH entry, not a hard-coded root.
  assert.equal(profiles.find(({ id }) => id === 'msys2').executable, 'D:\\software\\msys\\msys2\\usr\\bin\\bash.exe');
  assert.equal(profiles.find(({ id }) => id === 'wsl').pathPrepend[0], 'C:\\Windows\\System32');
});

test('the WSL launcher in system32 is never mistaken for an MSYS2 or Cygwin shell', async () => {
  const profiles = await discoverTerminalProfiles({
    platform: 'win32',
    env: { SystemRoot: 'C:\\Windows', PATH: 'C:\\Windows\\System32' },
    isExecutable: (file) => ['C:\\Windows\\System32\\bash.exe', 'C:\\Windows\\System32\\cmd.exe'].includes(file),
    listWsl: async () => [],
  });
  assert.deepEqual(profiles.map(({ id }) => id), ['cmd']);
});

test('Unix offers every installed non-login shell exactly once', async () => {
  const installed = new Set(['/bin/zsh', '/bin/bash', '/bin/fish', '/usr/bin/ksh', '/usr/local/bin/nu']);
  const profiles = await discoverTerminalProfiles({
    platform: 'linux', env: { SHELL: '/bin/zsh' },
    isExecutable: (file) => installed.has(file),
  });
  assert.deepEqual(profiles.map(({ id }) => id), ['zsh', 'bash', 'fish', 'nu', 'ksh']);
  assert.deepEqual(profiles.map(({ family }) => family), ['posix', 'bash', 'posix', 'nu', 'posix']);
  assert.equal(profiles.filter(({ isDefault }) => isDefault).length, 1);
  assert.equal(profiles[0].executable, '/bin/zsh');
});
