import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';

const active = new Set();

// node-pty 1.1's Windows conout worker outlives a naturally exited shell. An
// owning Worker gives every PTY a complete lifecycle without private APIs.
export function spawnPty(file, args, options) {
  const workerPath = fileURLToPath(new URL('./terminal-worker.mjs', import.meta.url))
    .replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2');
  const worker = new Worker(workerPath, { workerData: { file, args, options } });
  const dataListeners = new Set();
  const exitListeners = new Set();
  let ended = false;
  let closing = false;
  let reportedExit = false;
  let killTimer;
  let complete;
  const completion = new Promise((resolve) => { complete = resolve; });
  const emitExit = (exitCode) => {
    if (reportedExit) return;
    reportedExit = true;
    for (const listener of [...exitListeners]) listener({ exitCode });
  };
  function kill() {
    if (ended || closing) return;
    closing = true;
    worker.postMessage({ type: 'close' });
    // A crashed native helper must not keep app quit pending indefinitely.
    killTimer = setTimeout(() => { void worker.terminate(); }, 3000);
    killTimer.unref();
  }
  const control = { kill, completion };
  active.add(control);
  worker.on('message', (message) => {
    if (message.type === 'data') for (const listener of [...dataListeners]) listener(message.data);
    if (message.type === 'exit') emitExit(message.exitCode);
  });
  worker.on('error', (error) => {
    for (const listener of [...dataListeners]) listener(`\r\nTerminal failed: ${error.message}\r\n`);
    emitExit(1);
  });
  worker.once('exit', (code) => {
    ended = true;
    clearTimeout(killTimer);
    active.delete(control);
    emitExit(closing ? 0 : code || 1);
    complete();
  });
  const send = (message) => {
    if (ended || closing || reportedExit) throw new Error('The terminal process has exited.');
    worker.postMessage(message);
  };
  const subscribe = (listeners, callback) => {
    listeners.add(callback);
    return { dispose: () => listeners.delete(callback) };
  };
  return {
    write: (data) => send({ type: 'write', data }),
    resize: (cols, rows) => send({ type: 'resize', cols, rows }),
    kill,
    onData: (callback) => subscribe(dataListeners, callback),
    onExit: (callback) => subscribe(exitListeners, callback),
  };
}

export async function shutdownPtyWorkers() {
  const pending = [...active];
  for (const worker of pending) worker.kill();
  await Promise.all(pending.map((worker) => worker.completion));
}
