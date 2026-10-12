import assert from 'node:assert/strict';
import test from 'node:test';

import {
  TERMINAL_COMMAND_LIMITS,
  createCommandCatalog,
  discoverTerminalCommandList,
  discoverTerminalCommands,
  shellArguments,
  isReportedCommandName,
  shellInternalCommands,
  shellReportCommand,
  shellSearchPath,
} from '../src/terminal-commands.mjs';

const file = (name) => ({ name, isFile: () => true });

/** What the discovery answers with: names, plus the ones the shell reported. */
function list(...names) {
  return { names, shellReported: [] };
}

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
        return /compgen -b/.test(command) ? 'cd\nalias\n' : 'bash\ngit\n\n/usr/bin/coreutils\n';
      },
    },
  );
  assert.deepEqual(commands, ['bash', 'git', '/usr/bin/coreutils', 'cd', 'alias']);
  // One call for the distro's PATH listing, one for its shell's builtins.
  assert.equal(asked.length, 2);
  assert.equal(asked[0][0], 'C:\\Windows\\System32\\wsl.exe');
  assert.match(asked[0][1], /for d in \$PATH/);
  assert.match(asked[1][1], /bash -c 'compgen -b'/);
});

test("a WSL session's builtins are marked as the shell's own", async () => {
  const discovered = await discoverTerminalCommandList(
    { id: 'wsl', family: 'wsl', executable: 'wsl.exe' },
    {
      platform: 'win32',
      environment: { Path: 'C:\\Windows' },
      runShell: async (_profile, command) => (/compgen -b/.test(command) ? 'cd\nalias\nls\n' : 'ls\nsh\n'),
    },
  );
  // `ls` is a file in the distro; `cd` and `alias` are builtins it runs anyway.
  assert.deepEqual(discovered, { names: ['ls', 'sh', 'cd', 'alias'], shellReported: ['cd', 'alias'] });
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
  // Padded to four digits so the alphabetical order the scan produces is also
  // the numeric order the assertion expects, whatever the limit is.
  const name = (index) => `cmd-${String(index).padStart(4, '0')}`;
  const crowded = Array.from({ length: TERMINAL_COMMAND_LIMITS.commands + 100 }, (_value, index) => file(name(index)));
  const scanned = [];
  const commands = await discoverTerminalCommands(
    { id: 'bash', pathPrepend: [] },
    {
      platform: 'linux',
      environment: { PATH: '/first:/second' },
      // The profile asks bash for its builtins too; that report is empty here.
      listDirectory: async (directory) => { scanned.push(directory); return directory === '/first' ? crowded : [file('later')]; },
      isExecutable: () => true,
      runShell: async () => '',
    },
  );
  assert.deepEqual(scanned, ['/first'], 'a full list must stop the scan');
  assert.equal(commands.length, TERMINAL_COMMAND_LIMITS.commands);
  assert.equal(commands[0], name(0));
  assert.equal(commands.at(-1), name(TERMINAL_COMMAND_LIMITS.commands - 1));
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
    discover: async () => { scans += 1; return list(`scan-${scans}`); },
    now: () => clock,
    cacheMs: 100,
    // No persisted window here: an expired entry is rebuilt before it answers.
    persistedMs: 0,
  });
  const profile = { id: 'bash' };
  assert.deepEqual(await catalog.commands(profile), list('scan-1'));
  assert.deepEqual(await catalog.commands(profile), list('scan-1'));
  assert.equal(scans, 1, 'a cached profile must not rescan the PATH');
  clock += 101;
  assert.deepEqual(await catalog.commands(profile), list('scan-2'));
  assert.equal(scans, 2);
  catalog.clear();
  assert.deepEqual(await catalog.commands(profile), list('scan-3'));
});

test('an empty scan is retried instead of being cached for the window', async () => {
  let scans = 0;
  const catalog = createCommandCatalog({
    discover: async () => { scans += 1; return scans === 1 ? list() : list('git'); },
    now: () => 1_000,
    cacheMs: 100_000,
  });
  const profile = { id: 'wsl' };
  assert.deepEqual(await catalog.commands(profile), list(), 'a shell that answered nothing reports nothing');
  assert.deepEqual(await catalog.commands(profile), list('git'), 'the next request must ask the shell again');
  assert.equal(scans, 2);
  assert.deepEqual(await catalog.commands(profile), list('git'), 'a real list is cached');
  assert.equal(scans, 2);
});

test('the shell reports its own commands next to the PATH executables', async () => {
  const asked = [];
  const commands = await discoverTerminalCommands(
    { id: 'bash', family: 'bash', executable: '/bin/bash', pathPrepend: [] },
    {
      platform: 'linux',
      environment: { PATH: '/bin' },
      listDirectory: async () => [file('ls'), file('cp')],
      isExecutable: () => true,
      runShell: async (profile, command) => { asked.push(command); return 'cd\necho\nls\ncompgen\n'; },
    },
  );
  // PATH order first (that is what a shell resolves first, alphabetical inside a
  // directory), then the builtins the shell reported, without repeating a name.
  assert.deepEqual(commands, ['cp', 'ls', 'cd', 'echo', 'compgen']);
  assert.deepEqual(asked, ['compgen -b'], 'bash is asked for its builtins');
});

test('PowerShell is asked for its cmdlets and functions', async () => {
  const asked = [];
  const commands = await discoverTerminalCommands(
    { id: 'powershell', family: 'powershell', executable: 'C:\\pwsh.exe', pathPrepend: ['C:\\tools'] },
    {
      platform: 'win32',
      environment: { Path: 'C:\\tools', PATHEXT: '.EXE' },
      listDirectory: async () => [file('git.exe')],
      runShell: async (_profile, command) => { asked.push(command); return 'Get-ChildItem\nGet-Content\n'; },
    },
  );
  assert.deepEqual(commands, ['git', 'Get-ChildItem', 'Get-Content']);
  assert.match(asked[0], /Get-Command -CommandType Cmdlet,Function,Alias/);
});

test('the aliases a shell reports are offered, except punctuation', async () => {
  // `gci` and `sl` are what a PowerShell user types; `?` and `%` are not words to
  // complete, so a name the renderer cannot offer is dropped.
  const commands = await discoverTerminalCommands(
    { id: 'powershell', family: 'powershell', executable: 'C:\\pwsh.exe', pathPrepend: [] },
    {
      platform: 'win32',
      environment: { Path: 'C:\\tools', PATHEXT: '.EXE' },
      listDirectory: async () => [file('git.exe')],
      runShell: async () => 'Get-ChildItem\ngci\nsl\n?\n%\ncd..\n',
    },
  );
  assert.deepEqual(commands, ['git', 'Get-ChildItem', 'gci', 'sl', 'cd..']);
  // The rule the discovery and the verification share.
  assert.equal(isReportedCommandName('gci'), true);
  assert.equal(isReportedCommandName('Get-ChildItem'), true);
  assert.equal(isReportedCommandName('?'), false);
  assert.equal(isReportedCommandName(''), false);
});

test('a report that answers nothing is asked for once more', async () => {
  const asked = [];
  const commands = await discoverTerminalCommands(
    { id: 'powershell', family: 'powershell', executable: 'C:\\pwsh.exe', pathPrepend: ['C:\\tools'] },
    {
      platform: 'win32',
      environment: { Path: 'C:\\tools', PATHEXT: '.EXE' },
      listDirectory: async () => [file('git.exe')],
      runShell: async (_profile, command) => {
        asked.push(command);
        // The first attempt times out (the runner answers with nothing), the
        // second one is the cold host finally starting.
        return asked.length === 1 ? '' : 'Get-ChildItem\n';
      },
    },
  );
  assert.deepEqual(commands, ['git', 'Get-ChildItem']);
  assert.equal(asked.length, 2, 'an empty report is retried once');
});

test('a shell that keeps answering nothing is not asked forever', async () => {
  const asked = [];
  const commands = await discoverTerminalCommands(
    { id: 'bash', family: 'bash', executable: '/bin/bash', pathPrepend: [] },
    {
      platform: 'linux',
      environment: { PATH: '/bin' },
      listDirectory: async () => [file('ls')],
      isExecutable: () => true,
      runShell: async (_profile, command) => { asked.push(command); return ''; },
    },
  );
  assert.deepEqual(commands, ['ls']);
  assert.equal(asked.length, 2, 'one retry, not a loop');
});

test('a shell with nothing to report about itself is not asked', async () => {
  let calls = 0;
  const discovered = await discoverTerminalCommandList(
    { id: 'cmd', family: 'cmd', executable: 'C:\\Windows\\System32\\cmd.exe', pathPrepend: ['C:\\Windows'] },
    {
      platform: 'win32',
      environment: { Path: 'C:\\Windows', PATHEXT: '.EXE' },
      listDirectory: async () => [file('cmd.exe')],
      runShell: async () => { calls += 1; return 'should not be asked'; },
    },
  );
  assert.equal(discovered.names[0], 'cmd', 'the PATH names come first');
  assert.equal(calls, 0, 'cmd has no listing of its own to ask for');
  // Its internals come from the written-down list instead: `copy` is nowhere on
  // the PATH, and a cmd session runs it anyway.
  assert.ok(discovered.names.includes('copy'));
  assert.ok(discovered.names.includes('cls'));
  assert.ok(discovered.shellReported.includes('copy'));
});

test('a cmd internal that also exists as a file stays the one on the PATH', async () => {
  const discovered = await discoverTerminalCommandList(
    { id: 'cmd', family: 'cmd', executable: 'C:\\Windows\\System32\\cmd.exe', pathPrepend: [] },
    {
      platform: 'win32',
      environment: { Path: 'C:\\tools', PATHEXT: '.EXE' },
      // MSYS2 ships `dir`, so the name exists twice: the file wins and the
      // internal is not added a second time, nor claimed as shell-owned.
      listDirectory: async () => [file('dir.exe')],
    },
  );
  assert.equal(discovered.names.filter((name) => name === 'dir').length, 1);
  assert.equal(discovered.shellReported.includes('dir'), false);
  assert.ok(discovered.shellReported.includes('mkdir'));
});

test('the shell report cannot push the list past its limit', async () => {
  const reported = Array.from({ length: TERMINAL_COMMAND_LIMITS.commands + 500 }, (_value, index) => `builtin-${String(index).padStart(4, '0')}`).join('\n');
  const commands = await discoverTerminalCommands(
    { id: 'bash', family: 'bash', executable: '/bin/bash', pathPrepend: [] },
    {
      platform: 'linux',
      environment: { PATH: '/bin' },
      listDirectory: async () => [file('ls')],
      isExecutable: () => true,
      runShell: async () => reported,
    },
  );
  assert.equal(commands.length, TERMINAL_COMMAND_LIMITS.commands);
  assert.equal(commands[0], 'ls');
});

test('each shell family gets the argv that runs one command', () => {
  assert.deepEqual(shellArguments({ family: 'powershell' }, 'exit 0'), ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', 'exit 0']);
  assert.deepEqual(shellArguments({ family: 'cmd' }, 'echo hi'), ['/d', '/c', 'echo hi']);
  assert.deepEqual(shellArguments({ family: 'wsl' }, 'pwd'), ['-e', 'sh', '-c', 'pwd']);
  assert.deepEqual(shellArguments({ family: 'bash' }, 'compgen -b'), ['-c', 'compgen -b']);
  assert.deepEqual(shellArguments({ family: 'posix' }, 'true'), ['-c', 'true']);
});

test('only a family that can report its own commands says so', () => {
  assert.match(shellReportCommand('powershell'), /Get-Command -CommandType Cmdlet,Function/);
  assert.equal(shellReportCommand('bash'), 'compgen -b');
  assert.equal(shellReportCommand('posix'), 'compgen -b');
  // cmd has no comparable listing, and a WSL session is asked inside the distro.
  assert.equal(shellReportCommand('cmd'), '');
  // A WSL session's shell is bash, and it is asked in there through bash.
  assert.match(shellReportCommand('wsl'), /compgen -b/);
  assert.equal(shellReportCommand(undefined), '');
});

test("cmd's internals are written down, and only cmd has any", () => {
  const internals = shellInternalCommands('cmd');
  for (const name of ['copy', 'del', 'cls', 'type', 'set']) assert.ok(internals.includes(name), `cmd runs ${name}`);
  assert.equal(internals.includes('where'), false, 'a tool with a file behind it is found on the PATH');
  for (const name of internals) assert.equal(isReportedCommandName(name), true, `${name} has to be a name the renderer can offer`);
  assert.deepEqual(shellInternalCommands('powershell'), []);
  assert.deepEqual(shellInternalCommands('bash'), []);
  assert.deepEqual(shellInternalCommands(undefined), []);
});

test('the limit leaves room for both the PATH executables and the shell report', () => {
  // A PowerShell session offers about 3 200 names on the machine this was
  // written on; a bound near that number would cut the cmdlets alphabetically.
  assert.ok(TERMINAL_COMMAND_LIMITS.commands >= 4_000);
});

test('a persisted list answers immediately while a fresh one is built in the background', async () => {
  let scans = 0;
  const written = [];
  const clock = 1_000_000;
  const catalog = createCommandCatalog({
    discover: async () => { scans += 1; return list('fresh'); },
    now: () => clock,
    cacheMs: 1_000,
    persistedMs: 100_000,
    store: {
      read: async () => ({ bash: { at: clock - 5_000, commands: list('cached') } }),
      write: async (record) => { written.push(record); },
    },
  });
  const profile = { id: 'bash' };

  // Older than the memory window but inside the persisted one: the caller gets
  // the list it has, and the shell is asked again without being waited for.
  assert.deepEqual(await catalog.commands(profile), list('cached'));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(scans, 1, 'the refresh still runs');
  assert.deepEqual(await catalog.commands(profile), list('fresh'), 'and replaces the answer');
  assert.deepEqual(written.at(-1).bash.commands.names, ['fresh'], 'the new list is written back');
});

test('a persisted list past its window is rebuilt before it is answered with', async () => {
  let scans = 0;
  const catalog = createCommandCatalog({
    discover: async () => { scans += 1; return list('fresh'); },
    now: () => 1_000_000,
    cacheMs: 1_000,
    persistedMs: 100_000,
    store: { read: async () => ({ bash: { at: 1_000_000 - 200_000, commands: list('stale') } }), write: async () => {} },
  });
  assert.deepEqual(await catalog.commands({ id: 'bash' }), list('fresh'));
  assert.equal(scans, 1);
});

test('an unreadable store is just a cold start', async () => {
  const catalog = createCommandCatalog({
    discover: async () => list('fresh'),
    store: { read: async () => { throw new Error('boom'); }, write: async () => { throw new Error('boom'); } },
  });
  assert.deepEqual(await catalog.commands({ id: 'bash' }), list('fresh'));
});

test('one shell asking while a refresh is in flight does not scan twice', async () => {
  let scans = 0;
  let release;
  const catalog = createCommandCatalog({
    discover: async () => {
      scans += 1;
      await new Promise((resolve) => { release = resolve; });
      return list('fresh');
    },
    store: undefined,
  });
  const first = catalog.commands({ id: 'bash' });
  const second = catalog.commands({ id: 'bash' });
  await new Promise((resolve) => setTimeout(resolve, 0));
  release?.();
  assert.deepEqual(await Promise.all([first, second]), [list('fresh'), list('fresh')]);
  assert.equal(scans, 1, 'concurrent callers share one scan');
});

test('the discovery keeps the shell-reported names apart from the PATH ones', async () => {
  const discovered = await discoverTerminalCommandList(
    { id: 'bash', family: 'bash', executable: '/bin/bash', pathPrepend: [] },
    {
      platform: 'linux',
      environment: { PATH: '/bin' },
      listDirectory: async () => [file('ls'), file('git')],
      isExecutable: () => true,
      runShell: async () => 'cd\nalias\nls\n',
    },
  );
  assert.deepEqual(discovered, { names: ['git', 'ls', 'cd', 'alias'], shellReported: ['cd', 'alias'] });
});

test('a distro whose bash answers nothing reports only the files it lists', async () => {
  // A distro without bash (or one that refused the report) still publishes its
  // PATH listing; the builtins are simply absent.
  const discovered = await discoverTerminalCommandList(
    { id: 'wsl', family: 'wsl', executable: 'wsl.exe' },
    { runShell: async (_profile, command) => (/compgen -b/.test(command) ? '' : 'ls\nsh\n') },
  );
  assert.deepEqual(discovered, { names: ['ls', 'sh'], shellReported: [] });
});