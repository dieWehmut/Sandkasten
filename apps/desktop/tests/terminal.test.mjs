import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { createTerminalHost, sessionEnvironment, TERMINAL_LIMITS } from '../src/terminal.mjs';

function harness(overrides = {}) {
  const processes = [];
  const events = [];
  let cwd;
  const host = createTerminalHost({
    profiles: [{ id: 'cmd', label: 'Command Prompt', executable: 'C:\\Windows\\System32\\cmd.exe', args: ['/d'], isDefault: true }],
    getCwd: () => cwd,
    homeDirectory: 'C:\\Users\\test',
    spawn(executable, args, options) {
      const emitter = new EventEmitter();
      const pty = {
        executable, args, options, writes: [], sizes: [], killed: false,
        write: (data) => pty.writes.push(data),
        resize: (cols, rows) => pty.sizes.push([cols, rows]),
        kill: () => { pty.killed = true; },
        onData: (callback) => { emitter.on('data', callback); return { dispose: () => emitter.off('data', callback) }; },
        onExit: (callback) => { emitter.on('exit', callback); return { dispose: () => emitter.off('exit', callback) }; },
        data: (data) => emitter.emit('data', data),
        exit: (exitCode) => emitter.emit('exit', { exitCode }),
      };
      processes.push(pty);
      return pty;
    },
    onData: (owner, event) => events.push({ owner, type: 'data', ...event }),
    onExit: (owner, event) => events.push({ owner, type: 'exit', ...event }),
    ...overrides,
  });
  return { host, processes, events, setCwd: (value) => { cwd = value; } };
}

test('sessions start in the workspace or home and buffer the prompt until attached', (t) => {
  const { host, processes, events, setCwd } = harness();
  t.after(() => host.dispose());
  assert.deepEqual(host.profiles(), [{ id: 'cmd', label: 'Command Prompt', family: 'posix', isDefault: true }]);
  const first = host.create(1, { cols: 80, rows: 24 });
  assert.equal(first.cwd, 'C:\\Users\\test');
  assert.equal(first.profileId, 'cmd');
  assert.equal(processes[0].options.cwd, first.cwd);
  processes[0].data('prompt> ');
  assert.deepEqual(events, []);
  host.attach(1, first.id);
  assert.deepEqual(events, [{ owner: 1, type: 'data', id: first.id, data: 'prompt> ' }]);
  host.attach(1, first.id);
  assert.equal(events.length, 1, 'reattach must not replay output twice');
  setCwd('D:\\work');
  assert.equal(host.create(1, { cols: 100, rows: 30 }).cwd, 'D:\\work');
});

test('the renderer sees the shell family but never the executable or its command path', (t) => {
  const host = createTerminalHost({
    profiles: [{
      id: 'powershell', label: 'PowerShell', family: 'powershell', executable: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
      args: ['-NoLogo'], pathPrepend: ['C:\\Program Files\\PowerShell\\7'], isDefault: true,
    }],
    spawn: () => { throw new Error('no session is created here'); },
    getCwd: () => 'C:\\work',
    onData: () => {}, onExit: () => {},
  });
  t.after(() => host.dispose());
  assert.deepEqual(host.profiles(), [{ id: 'powershell', label: 'PowerShell', family: 'powershell', isDefault: true }]);
});

test('a persistent session accepts input, Ctrl+C and resize only from its owner', (t) => {
  const { host, processes } = harness();
  t.after(() => host.dispose());
  const { id } = host.create(1, { cols: 80, rows: 24 });
  for (const action of [() => host.attach(2, id), () => host.write(2, { id, data: 'bad' }), () => host.resize(2, { id, cols: 90, rows: 30 }), () => host.close(2, id)]) {
    assert.throws(action, /unknown terminal/i);
  }
  host.write(1, { id, data: 'echo hello\r' });
  host.write(1, { id, data: '\x03' });
  host.resize(1, { id, cols: 120, rows: 40 });
  assert.deepEqual(processes[0].writes, ['echo hello\r', '\x03']);
  assert.deepEqual(processes[0].sizes, [[120, 40]]);
  host.close(1, id);
  assert.equal(processes[0].killed, true);
  assert.throws(() => host.write(1, { id, data: 'late' }), /unknown terminal/i);
});

test('an early process exit replays final output before exit and releases the session', (t) => {
  const { host, processes, events } = harness();
  t.after(() => host.dispose());
  const { id } = host.create(1, { cols: 80, rows: 24 });
  processes[0].data('goodbye');
  processes[0].exit(7);
  assert.deepEqual(events, []);
  host.attach(1, id);
  assert.deepEqual(events, [
    { owner: 1, type: 'data', id, data: 'goodbye' },
    { owner: 1, type: 'exit', id, exitCode: 7 },
  ]);
  assert.throws(() => host.write(1, { id, data: 'late' }), /unknown terminal/i);
});

test('rejects arbitrary shells, malformed dimensions and oversized input before spawning or writing', (t) => {
  const { host, processes } = harness();
  t.after(() => host.dispose());
  for (const request of [null, [], { cols: 0, rows: 24 }, { cols: 80, rows: Infinity }, { cols: 3.5, rows: 24 }, { cols: 80, rows: 9999 }, { cols: 80, rows: 24, profileId: 'evil.exe' }]) {
    assert.throws(() => host.create(1, request), /terminal|profile|dimensions/i);
  }
  assert.equal(processes.length, 0);
  const { id } = host.create(1, { cols: 80, rows: 24 });
  for (const data of [null, 42, 'x'.repeat(TERMINAL_LIMITS.inputBytes + 1)]) {
    assert.throws(() => host.write(1, { id, data }), /input/i);
  }
  assert.throws(() => host.resize(1, { id, cols: -1, rows: 24 }), /dimensions/i);
  assert.deepEqual(processes[0].writes, []);
});

test('bounds sessions and pending output while cleaning up only the reloading owner', (t) => {
  const { host, processes, events } = harness();
  t.after(() => host.dispose());
  const first = host.create(1, { cols: 80, rows: 24 });
  processes[0].data('x'.repeat(TERMINAL_LIMITS.pendingCharacters * 2));
  processes[0].data('tail');
  host.attach(1, first.id);
  const data = events.filter((event) => event.type === 'data').map((event) => event.data).join('');
  assert.ok(data.length <= TERMINAL_LIMITS.pendingCharacters);
  assert.ok(data.endsWith('tail'));
  for (let i = 1; i < TERMINAL_LIMITS.sessionsPerOwner; i++) host.create(1, { cols: 80, rows: 24 });
  assert.throws(() => host.create(1, { cols: 80, rows: 24 }), /limit/i);
  const other = host.create(2, { cols: 80, rows: 24 });
  host.disposeOwner(1);
  assert.ok(processes.slice(0, -1).every((pty) => pty.killed));
  assert.equal(processes.at(-1).killed, false);
  host.write(2, { id: other.id, data: 'alive' });
  host.dispose();
  assert.equal(processes.at(-1).killed, true);
});

test('a shell session PATH gains its own command directories without losing or duplicating entries', () => {
  const windows = sessionEnvironment(
    { pathPrepend: ['C:\\tools\\Git\\usr\\bin', 'C:\\tools\\Git\\mingw64\\bin'] },
    { Path: 'C:\\Windows;C:\\tools\\git\\USR\\bin', TEMP: 'C:\\Temp' },
    'win32',
  );
  assert.equal(windows.Path, 'C:\\tools\\Git\\mingw64\\bin;C:\\Windows;C:\\tools\\git\\USR\\bin');
  assert.equal(windows.PATH, undefined, 'the existing Path key is reused instead of duplicated');
  assert.equal(windows.TERM, 'xterm-256color');
  assert.equal(windows.COLORTERM, 'truecolor');
  assert.equal(windows.TEMP, 'C:\\Temp');

  const posix = sessionEnvironment({ pathPrepend: ['/opt/msys2/usr/bin'] }, { PATH: '/usr/bin:/bin' }, 'linux');
  assert.equal(posix.PATH, '/opt/msys2/usr/bin:/usr/bin:/bin');

  const plain = sessionEnvironment({ id: 'cmd' }, { PATH: '/usr/bin' }, 'linux');
  assert.equal(plain.PATH, '/usr/bin', 'a shell without its own directory leaves PATH untouched');
});

test('the host publishes the commands a profile can run and caches one scan per profile', async (t) => {
  const scanned = [];
  const profiles = [{
    id: 'git-bash', label: 'Git Bash', family: 'bash', executable: 'C:\\Git\\bin\\bash.exe',
    args: ['--login', '-i'], isDefault: true, pathPrepend: ['C:\\Git\\usr\\bin'],
  }];
  const { host } = harness({
    profiles,
    platform: 'win32',
    environment: { Path: 'C:\\Windows' },
    discoverCommands: async (profile, options) => {
      scanned.push([profile.id, options.platform, options.environment.Path]);
      return ['git', 'ls'];
    },
  });
  t.after(() => host.dispose());
  assert.deepEqual(await host.commands(1, 'git-bash'), ['git', 'ls']);
  assert.deepEqual(await host.commands(1, 'git-bash'), ['git', 'ls']);
  assert.equal(scanned.length, 1, 'the catalog must not rescan the same profile');
  assert.deepEqual(scanned[0], ['git-bash', 'win32', 'C:\\Windows']);
  await assert.rejects(() => host.commands(1, 'nope'), /unknown terminal profile/i);
  for (const profileId of ['', 42, null, undefined]) {
    await assert.rejects(() => host.commands(1, profileId), /invalid terminal profile/i);
  }
  host.dispose();
  await assert.rejects(() => host.commands(1, 'git-bash'), /shut down/i);
});

test('a spawned session inherits the enriched environment instead of the raw process one', (t) => {
  const processes = [];
  const host = createTerminalHost({
    profiles: [{
      id: 'git-bash', label: 'Git Bash', family: 'bash', executable: 'C:\\tools\\Git\\bin\\bash.exe',
      args: ['--login', '-i'], isDefault: true, pathPrepend: ['C:\\tools\\Git\\usr\\bin'],
    }],
    getCwd: () => 'C:\\work',
    homeDirectory: 'C:\\Users\\test',
    platform: 'win32',
    environment: { Path: 'C:\\Windows', TERM: 'dumb' },
    spawn(executable, args, options) {
      const pty = {
        executable, args, options,
        write() {}, resize() {}, kill() {},
        onData: () => ({ dispose() {} }), onExit: () => ({ dispose() {} }),
      };
      processes.push(pty);
      return pty;
    },
    onData: () => {}, onExit: () => {},
  });
  t.after(() => host.dispose());
  host.create(1, { cols: 80, rows: 24 });
  assert.equal(processes[0].options.cwd, 'C:\\work');
  assert.equal(processes[0].options.env.Path, 'C:\\tools\\Git\\usr\\bin;C:\\Windows');
  assert.equal(processes[0].options.env.TERM, 'xterm-256color');
});
