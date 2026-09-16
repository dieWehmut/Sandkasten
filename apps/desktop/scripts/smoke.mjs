#!/usr/bin/env node
// Launch Electron headlessly, load the bundled apps/web distribution, and
// assert the Vue shell mounted. Exits non-zero when the window cannot start.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveVerifiedDistribution } from '../src/distribution.mjs';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const probePath = path.join(appRoot, 'scripts', 'smoke-probe.mjs');

async function main() {
  const distribution = await resolveVerifiedDistribution({ appRoot });
  const index = path.join(distribution, 'index.html');

  const electronBinary = (await import('electron')).default;
  const child = spawn(electronBinary, [probePath], {
    env: { ...process.env, SANDKASTEN_SMOKE_INDEX: index },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });

  const code = await new Promise((resolve) => child.on('close', resolve));
  const lastLine = stdout.trim().split('\n').filter(Boolean).at(-1);

  if (code !== 0 || !lastLine?.startsWith('{')) {
    process.stderr.write(`desktop smoke failed (exit ${code})\n${stderr}${stdout}`);
    process.exitCode = 1;
    return;
  }

  const result = JSON.parse(lastLine);
  process.stdout.write(`desktop smoke: shell=${result.shell} title=${result.title}\n`);
  process.exitCode = result.shell ? 0 : 1;
}

main().catch((error) => {
  process.stderr.write(`desktop smoke: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
