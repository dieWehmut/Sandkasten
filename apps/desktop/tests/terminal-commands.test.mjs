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

test('a WSL profile lists the commands inside the distro, not the Windows ones', async () => {
  const asked = [];
  const commands = await discoverTerminalCommands(
    { id: 'wsl', family: 'wsl', executable: 'C:\\Windows\\System32\\wsl.exe', pathPrepend: ['C:\\Windows\\System32'] },
    {
      platform: 'win32',
      environment: { Path: 'C:\\Windows\\System32' },
      // The Windows listing must never be consulted for a distro session.
      listDirectory: async () => [file('cmd.exe')],
      runShell: async (profile, command) => {
        asked.push([profile.executable, command]);
        return 'bash\ngit\n\n/usr/bin/coreutils\n';
      },
    },
  );
  assert.deepEqual(commands, ['bash', 'git', '/usr/bin/coreutils']);
  assert.equal(asked.length, 1);
  assert.equal(asked[0][0], 'C:\\Windows\\System32\\wsl.exe');
  assert.match(asked[0][1], /for d in \$PATH/);
});

test('a distro that answers nothing or cannot be reached reports no commands', async () => {
  const silent = await discoverTerminalCommands(
    { id: 'wsl', family: 'wsl', executable: 'wsl.exe' },
    { platform: 'win32', environment: { Path: 'C:\\Windows' }, runShell: async () => '' },
  );
  assert.deepEqual(silent, []);
  const unreachable = await discoverTerminalCommands(
    { id: 'wsl', family: 'wsl' },
    { platform: 'win32', environment: { Path: 'C:\\Windows' }, runShell: async () => '' },
  );
  assert.deepEqual(unreachable, []);
});

test('a WSL listing is deduplicated and capped like any other list', async () => {
  const listing = [...Array.from({ length: TERMINAL_COMMAND_LIMITS.commands }, (_value, index) => `tool-${String(index).padStart(3, '0')}`), 'tool-000', 'extra'];
  const commands = await discoverTerminalCommands(
    { id: 'wsl', family: 'wsl', executable: 'wsl.exe' },
    { platform: 'win32', environment: { Path: 'C:\\Windows' }, runShell: async () => listing.join('\n') },
  );
  assert.equal(commands.length, TERMINAL_COMMAND_LIMITS.commands);
  assert.equal(commands[0], 'tool-000');
  assert.equal(commands.at(-1), `tool-${String(TERMINAL_COMMAND_LIMITS.commands - 1).padStart(3, '0')}`);
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

test('an empty scan is retried instead of being cached for the window', async () => {
  let scans = 0;
  const catalog = createCommandCatalog({
    discover: async () => { scans += 1; return scans === 1 ? [] : ['git']; },
    now: () => 1_000,
    cacheMs: 100_000,
  });
  const profile = { id: 'wsl' };
  assert.deepEqual(await catalog.commands(profile), [], 'a shell that answered nothing reports nothing');
  assert.deepEqual(await catalog.commands(profile), ['git'], 'the next request must ask the shell again');
  assert.equal(scans, 2);
  assert.deepEqual(await catalog.commands(profile), ['git'], 'a real list is cached');
  assert.equal(scans, 2);
});