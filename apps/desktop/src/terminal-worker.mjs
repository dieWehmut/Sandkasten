import { parentPort, workerData } from 'node:worker_threads';
import pty from 'node-pty';

let pending = '';
let flushTimer;
let closing = false;
const flush = () => {
  clearTimeout(flushTimer);
  flushTimer = undefined;
  if (pending) parentPort.postMessage({ type: 'data', data: pending });
  pending = '';
};
const finish = (exitCode) => {
  flush();
  parentPort.postMessage({ type: 'exit', exitCode });
  // In a Worker this ends this thread and its children, never Electron's main
  // process. It also releases node-pty's otherwise retained conout worker.
  process.exit(0);
};
try {
  const terminal = pty.spawn(workerData.file, workerData.args, {
    ...workerData.options,
    ...(process.platform === 'win32' ? { useConptyDll: true } : {}),
  });
  terminal.onData((data) => {
    pending = (pending + data).slice(-256 * 1024);
    if (!flushTimer) flushTimer = setTimeout(flush, 16);
  });
  terminal.onExit(({ exitCode }) => finish(exitCode));
  parentPort.on('message', (message) => {
    if (closing) return;
    try {
      if (message.type === 'write') terminal.write(message.data);
      if (message.type === 'resize') terminal.resize(message.cols, message.rows);
      if (message.type === 'close') {
        closing = true;
        terminal.kill();
        // Windows kill can close the output socket before emitting onExit.
        setTimeout(() => finish(0), 1500);
      }
    } catch (error) {
      if (!closing) parentPort.postMessage({ type: 'data', data: `\r\nTerminal: ${error.message}\r\n` });
    }
  });
} catch (error) {
  parentPort.postMessage({ type: 'data', data: `\r\nCannot start terminal: ${error.message}\r\n` });
  finish(1);
}
