import { spawnPty } from '../../src/terminal-pty.mjs';

const windows = process.platform === 'win32';
const pty = spawnPty(windows ? process.env.ComSpec : '/bin/sh', windows ? ['/d'] : [], {
  cols: 80, rows: 24, cwd: process.cwd(), env: process.env,
});
let finished = false;
let output = '';
let requestedChild = false;
pty.onData((data) => {
  output += data;
  if (finished) return;
  if (process.argv[2] === 'close') {
    if (!requestedChild) {
      requestedChild = true;
      pty.write(`"${process.execPath}" -e "console.log('CHILD_PID='+process.pid);setInterval(()=>{},1000)"\r`);
    }
    const match = /CHILD_PID=(\d+)/.exec(output);
    if (match) {
      finished = true;
      console.log(`CHILD_PID=${match[1]}`);
      pty.kill();
    }
  } else {
    finished = true;
    pty.write('exit 0\r');
  }
});
pty.onExit(({ exitCode }) => {
  if (process.argv[2] === 'exit' && exitCode !== 0) process.exitCode = 1;
  console.log('TERMINAL_FINISHED');
});
