import assert from 'node:assert/strict';
import os from 'node:os';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { spawnPty } from '../src/terminal-pty.mjs';
import { createTerminalHost } from '../src/terminal.mjs';
import { discoverTerminalProfiles } from '../src/terminal-profiles.mjs';

test('real PTY preserves shell state, resizes, interrupts and exits', { timeout: 20000 }, async (t) => {
  const profiles = await discoverTerminalProfiles();
  const profile = profiles.find(({ id }) => id === (process.platform === 'win32' ? 'cmd' : 'sh'));
  assert.ok(profile, 'the operating system shell must be discoverable');
  let output = '';
  let exit;
  const terminal = createTerminalHost({
    profiles, spawn: spawnPty, getCwd: () => os.tmpdir(),
    onData: (_owner, event) => { output += event.data; },
    onExit: (_owner, event) => { exit = event.exitCode; },
  });
  t.after(() => terminal.dispose());
  const session = terminal.create(1, { profileId: profile.id, cols: 80, rows: 24 });
  terminal.attach(1, session.id);
  const write = (data) => terminal.write(1, { id: session.id, data });
  async function until(predicate, description) {
    const deadline = Date.now() + 5000;
    while (!predicate()) {
      if (Date.now() > deadline) assert.fail(`${description}\n${output}`);
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
  }
  const windows = process.platform === 'win32';
  write(windows ? 'set SK_PTY_VALUE=persistent\r' : 'SK_PTY_VALUE=persistent\r');
  write(windows ? 'echo STATE=%SK_PTY_VALUE%\r' : 'echo STATE=$SK_PTY_VALUE\r');
  await until(() => output.includes('STATE=persistent'), 'shell variables must persist between writes');
  terminal.resize(1, { id: session.id, cols: 110, rows: 32 });
  output = '';
  write(windows ? 'ping -n 30 127.0.0.1 >nul\r' : 'sleep 30\r');
  await new Promise((resolve) => setTimeout(resolve, 200));
  write('\x03');
  await new Promise((resolve) => setTimeout(resolve, 100));
  write(windows ? 'echo INTERRUPTED=%SK_PTY_VALUE%\r' : 'echo INTERRUPTED=$SK_PTY_VALUE\r');
  await until(() => output.includes('INTERRUPTED=persistent'), 'Ctrl+C must interrupt the child and return control to the same shell');
  write('exit 0\r');
  await until(() => exit !== undefined, 'shell exit must reach the renderer bridge');
  assert.equal(exit, 0);
});

test('natural exit and explicit close release native workers without stderr or a forced parent exit', { timeout: 20000 }, async () => {
  for (const action of ['exit', 'close']) {
    const { stdout, stderr } = await promisify(execFile)(process.execPath, [
      fileURLToPath(new URL('./fixtures/terminal-lifecycle.mjs', import.meta.url)), action,
    ], { timeout: 8000, windowsHide: true });
    assert.match(stdout, /TERMINAL_FINISHED/);
    assert.equal(stderr, '');
    if (action === 'close') {
      const childPid = Number(/CHILD_PID=(\d+)/.exec(stdout)?.[1]);
      assert.ok(childPid > 0, 'the fixture must start a long-running child before close');
      assert.throws(() => process.kill(childPid, 0), { code: 'ESRCH' }, 'close must stop the shell child too');
    }
  }
});
