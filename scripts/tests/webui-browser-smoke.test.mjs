import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { deflateSync } from 'node:zlib';
import {
  VIEWPORTS,
  createMockAppServer,
  findBrowserExecutable,
  inspectScreenshot,
  loadPlaywrightChromium,
  measurePixelDifference,
} from '../webui-browser-smoke-lib.mjs';

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([length, typeBuffer, data, checksum]);
}

function solidPng(width, height, rgba) {
  const signature = Buffer.from('89504e470d0a1a0a', 'hex');
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const row = Buffer.from(rgba.flatMap((pixel) => pixel));
  const scanlines = Buffer.concat(Array.from({ length: height }, () => Buffer.concat([Buffer.from([0]), row])));
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(scanlines)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

test('defines the required desktop, tablet, and mobile viewports', () => {
  assert.deepEqual(VIEWPORTS, [
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'tablet', width: 1024, height: 768 },
    { name: 'mobile', width: 390, height: 844 },
  ]);
});

test('finds an explicit browser before platform defaults', () => {
  const seen = [];
  const executable = findBrowserExecutable({
    env: { SANDKASTEN_BROWSER_PATH: 'D:/portable/chrome.exe' },
    platform: 'win32',
    existsSync(candidate) {
      seen.push(candidate);
      return candidate === 'D:/portable/chrome.exe';
    },
  });

  assert.equal(executable, 'D:/portable/chrome.exe');
  assert.deepEqual(seen, ['D:/portable/chrome.exe']);
});

test('loads Playwright Core relative to the WebUI package', () => {
  const chromium = { launch() {} };
  let anchor;
  const loaded = loadPlaywrightChromium({
    webuiDirectory: 'D:/Sandkasten/webui',
    createRequireImpl(packagePath) {
      anchor = packagePath;
      return (specifier) => {
        assert.equal(specifier, 'playwright-core');
        return { chromium };
      };
    },
  });

  assert.equal(anchor, path.join('D:/Sandkasten/webui', 'package.json'));
  assert.equal(loaded, chromium);
});

test('reports screenshot dimensions, color diversity, and real pixel differences', () => {
  const red = solidPng(2, 1, [[255, 0, 0, 255], [255, 0, 0, 255]]);
  const mixed = solidPng(2, 1, [[255, 0, 0, 255], [0, 0, 255, 255]]);

  assert.deepEqual(inspectScreenshot(red), {
    width: 2,
    height: 1,
    opaquePixels: 2,
    distinctColors: 1,
  });
  assert.deepEqual(measurePixelDifference(red, mixed), {
    changedPixels: 1,
    totalPixels: 2,
    ratio: 0.5,
  });
});

test('serves the built app and advances mock jobs to a text-only success result', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'sandkasten-browser-smoke-'));
  const distDir = path.join(root, 'dist');
  await mkdir(distDir);
  await writeFile(path.join(distDir, 'index.html'), '<div id="app"></div>');
  await writeFile(path.join(distDir, 'app.js'), 'globalThis.__APP_LOADED__ = true;');
  await writeFile(path.join(distDir, 'styles.css'), 'body { color: black; }');
  await writeFile(path.join(distDir, 'config.js'), 'globalThis.SANDKASTEN_CONFIG ??= { apiBaseUrl: "" };');

  const app = await createMockAppServer({ distDir });
  t.after(() => app.close());

  const indexResponse = await fetch(app.url);
  assert.equal(indexResponse.status, 200);
  assert.match(await indexResponse.text(), /id="app"/);

  const runtimesResponse = await fetch(`${app.url}v1/runtimes`);
  const runtimes = await runtimesResponse.json();
  assert.equal(runtimes.runtimes[0].language, 'python');

  const submitResponse = await fetch(`${app.url}v1/python/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: 'print("smoke")', wait: false }),
  });
  const submitted = await submitResponse.json();
  assert.equal(submitted.status, 'JOB_STATUS_QUEUED');

  const running = await fetch(`${app.url}v1/jobs/${submitted.jobId}`).then((response) => response.json());
  const succeeded = await fetch(`${app.url}v1/jobs/${submitted.jobId}`).then((response) => response.json());
  assert.equal(running.status, 'JOB_STATUS_RUNNING');
  assert.equal(succeeded.status, 'JOB_STATUS_SUCCEEDED');
  assert.equal(succeeded.stdout, 'browser smoke output\n<em>rendered as text</em>');
  assert.equal(succeeded.stderr, 'browser smoke stderr');
});
