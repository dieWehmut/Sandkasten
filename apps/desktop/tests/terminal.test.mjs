import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { createTerminalHost, TERMINAL_LIMITS } from '../src/terminal.mjs';

function harness() {
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
  });
  return { host, processes, events, setCwd: (value) => { cwd = value; } };
}

test('sessions start in the workspace or home and buffer the prompt until attached', (t) => {
  const { host, processes, events, setCwd } = harness();
  t.after(() => host.dispose());
  assert.deepEqual(host.profiles(), [{ id: 'cmd', label: 'Command Prompt', isDefault: true }]);
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
