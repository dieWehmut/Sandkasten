import assert from 'node:assert/strict';
import test from 'node:test';

import {
  TERMINAL_COMMAND_LIMITS,
  createCommandCatalog,
  discoverTerminalCommands,
  shellSearchPath,
} from '../src/terminal-commands.mjs';

const file = (name) => ({ name, isFile: () => true });

test('the search path puts the profile directories first and drops duplicates', () => {
  const directories = shellSearchPath(
    { id: 'pwsh', pathPrepend: ['C:\\PowerShell\\7', 'C:\\Windows'] },
    { Path: 'C:\\WINDOWS;C:\\tools;;' },
    'win32',
  );
  assert.deepEqual(directories, ['C:\\PowerShell\\7', 'C:\\Windows', 'C:\\tools']);
});

test('Windows lists command names from the profile path then PATH, without duplicates', async () => {
  const entries = {
    'C:\\Git\\usr\\bin': [file('git.exe'), file('bash.exe')],
    'C:\\Windows': [file('cmd.exe'), file('notepad.exe'), file('win.ini')],
    'C:\\tools': [file('GIT.EXE'), file('run.cmd'), file('readme.txt'), { name: 'sub', isFile: () => false }],
  };
  const commands = await discoverTerminalCommands(
    { id: 'git-bash', pathPrepend: ['C:\\Git\\usr\\bin', 'C:\\Windows'] },
    {
      platform: 'win32',
      environment: { PATHEXT: '.COM;.EXE;.BAT;.CMD', Path: 'C:\\Windows;C:\\tools' },
      listDirectory: async (directory) => entries[directory] ?? [],
    },
  );
  assert.deepEqual(commands, ['bash', 'git', 'cmd', 'notepad', 'run']);
});

test('Windows falls back to the default extension set when the environment omits PATHEXT', async () => {
  const commands = await discoverTerminalCommands(
    { id: 'cmd', pathPrepend: ['C:\\t'] },
    {
      platform: 'win32',
      environment: { Path: 'C:\\t' },
      listDirectory: async () => [file('tool.exe'), file('tool.ps1'), file('wat')],
    },
  );
  assert.deepEqual(commands, ['tool']);
});

test('Unix keeps executable files under their own names', async () => {
  const listings = {
    '/opt/tools': [file('mytool'), file('not-exec'), { name: 'sub', isFile: () => false }],
    '/usr/bin': [file('ls'), file('sed')],
    '/bin': [file('sh')],
  };
  const commands = await discoverTerminalCommands(
    { id: 'bash', pathPrepend: ['/opt/tools'] },
    {
      platform: 'linux',
      environment: { PATH: '/usr/bin:/bin' },
      listDirectory: async (directory) => listings[directory] ?? [],
      isExecutable: (path) => !path.endsWith('not-exec'),
    },
  );
  assert.deepEqual(commands, ['mytool', 'ls', 'sed', 'sh']);
});

test('an unreadable PATH entry contributes nothing instead of failing the scan', async () => {
  const commands = await discoverTerminalCommands(
    { id: 'bash', pathPrepend: [] },
    {
      platform: 'linux',
      environment: { PATH: '/gone:/bin' },
      listDirectory: async (directory) => {
        if (directory === '/gone') throw new Error('EACCES');
        return [file('sh')];
      },
      isExecutable: () => true,
    },
  );
  assert.deepEqual(commands, ['sh']);
});

test('a WSL profile reports no command list instead of the Windows one', async () => {
  const commands = await discoverTerminalCommands(
    { id: 'wsl', family: 'wsl', pathPrepend: ['C:\\Windows\\System32'] },
    {
      platform: 'win32',
      environment: { Path: 'C:\\Windows\\System32' },
      listDirectory: async () => [file('cmd.exe')],
    },
  );
  assert.deepEqual(commands, [], 'the distro owns its PATH; Windows names would mislead');
});

test('the scan stops at the command limit while keeping the search-path order', async () => {
  const crowded = Array.from({ length: TERMINAL_COMMAND_LIMITS.commands + 100 }, (_value, index) => file(`cmd-${String(index).padStart(3, '0')}`));
  const scanned = [];
  const commands = await discoverTerminalCommands(
    { id: 'bash', pathPrepend: [] },
    {
      platform: 'linux',
      environment: { PATH: '/first:/second' },
      listDirectory: async (directory) => { scanned.push(directory); return directory === '/first' ? crowded : [file('later')]; },
      isExecutable: () => true,
    },
  );
  assert.deepEqual(scanned, ['/first'], 'a full list must stop the scan');
  assert.equal(commands.length, TERMINAL_COMMAND_LIMITS.commands);
  assert.equal(commands[0], 'cmd-000');
  assert.equal(commands.at(-1), `cmd-${String(TERMINAL_COMMAND_LIMITS.commands - 1).padStart(3, '0')}`);
});

test('the scan visits at most the directory limit', async () => {
  const directories = Array.from({ length: TERMINAL_COMMAND_LIMITS.directories + 10 }, (_value, index) => `/d${index}`);
  const scanned = [];
  const commands = await discoverTerminalCommands(
    { id: 'bash', pathPrepend: [] },
    {
      platform: 'linux',
      environment: { PATH: directories.join(':') },
      listDirectory: async (directory) => { scanned.push(directory); return [file(`tool-${directory.slice(2)}`)]; },
      isExecutable: () => true,
    },
  );
  assert.equal(scanned.length, TERMINAL_COMMAND_LIMITS.directories);
  assert.equal(commands.length, TERMINAL_COMMAND_LIMITS.directories);
  assert.deepEqual(commands.slice(0, 3), ['tool-0', 'tool-1', 'tool-2']);
  assert.ok(commands.every((name, index) => name === `tool-${index}`), 'commands keep the directory order');
});

test('the catalog scans a profile once and refreshes after its window', async () => {
  let scans = 0;
  let clock = 1_000;
  const catalog = createCommandCatalog({
    discover: async () => { scans += 1; return [`scan-${scans}`]; },
    now: () => clock,
    cacheMs: 100,
  });
  const profile = { id: 'bash' };
  assert.deepEqual(await catalog.commands(profile), ['scan-1']);
  assert.deepEqual(await catalog.commands(profile), ['scan-1']);
  assert.equal(scans, 1, 'a cached profile must not rescan the PATH');
  clock += 101;
  assert.deepEqual(await catalog.commands(profile), ['scan-2']);
  assert.equal(scans, 2);
  catalog.clear();
  assert.deepEqual(await catalog.commands(profile), ['scan-3']);
});