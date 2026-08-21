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
import {
  SETUP_FLOW_SELECTORS,
  createPlaywrightSetupDriver,
  runFirstVisitSetupFlow,
  runReopenedSetupFlow,
  setupLocaleActionSelector,
} from '../webui-browser-smoke.mjs';

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

test('defines stable setup and locale selectors for the first-visit browser flow', () => {
  assert.deepEqual(SETUP_FLOW_SELECTORS, {
    welcome: '[data-testid="setup-welcome"]',
    guide: '[data-testid="setup-guide"]',
    localeSwitcher: '[data-testid="locale-switcher"]',
    copyCommand: '[data-testid="copy-command-button"][data-action="copy-install-command"]',
    installCommand: '[data-testid="install-command"] code',
    dismiss: '[data-testid="setup-dismiss"][data-action="dismiss-setup"]',
    workbench: '[data-testid="workbench-shell"]',
    reopen: '[data-testid="open-setup-guide"][data-action="open-setup-guide"]',
  });
});

test('builds locale action selectors only for the supported languages', () => {
  assert.equal(
    setupLocaleActionSelector('zh-CN'),
    '[data-testid="locale-switcher"] [data-action="set-locale-zh-CN"]',
  );
  assert.equal(
    setupLocaleActionSelector('en'),
    '[data-testid="locale-switcher"] [data-action="set-locale-en"]',
  );
  assert.throws(() => setupLocaleActionSelector('fr'), /Unsupported smoke locale: fr/);
});

test('drives the first-visit setup, locale, copy, persistence, and dismissal contract', async () => {
  const calls = [];
  const command = 'sudo ./sandkasten-install.sh --mode webui';
  const driver = {
    waitForVisible(selector) { calls.push(['visible', selector]); },
    waitForHidden(selector) { calls.push(['hidden', selector]); },
    click(selector) { calls.push(['click', selector]); },
    waitForLocale(locale) { calls.push(['locale', locale]); },
    readText(selector) { calls.push(['text', selector]); return command; },
    expectClipboard(value) { calls.push(['clipboard', value]); },
    expectStoredValue(key, value) { calls.push(['storage', key, value]); },
    assertNoHorizontalOverflow(stage) { calls.push(['overflow', stage]); },
  };

  await runFirstVisitSetupFlow(driver);

  assert.deepEqual(calls, [
    ['visible', SETUP_FLOW_SELECTORS.welcome],
    ['visible', SETUP_FLOW_SELECTORS.guide],
    ['visible', SETUP_FLOW_SELECTORS.localeSwitcher],
    ['click', setupLocaleActionSelector('zh-CN')],
    ['locale', 'zh-CN'],
    ['storage', 'sandkasten-locale', 'zh-CN'],
    ['click', setupLocaleActionSelector('en')],
    ['locale', 'en'],
    ['storage', 'sandkasten-locale', 'en'],
    ['text', SETUP_FLOW_SELECTORS.installCommand],
    ['click', SETUP_FLOW_SELECTORS.copyCommand],
    ['clipboard', command],
    ['overflow', 'setup welcome'],
    ['click', SETUP_FLOW_SELECTORS.dismiss],
    ['hidden', SETUP_FLOW_SELECTORS.welcome],
    ['visible', SETUP_FLOW_SELECTORS.workbench],
    ['storage', 'sandkasten-install-guide-seen', 'true'],
  ]);
});

test('drives the header action that reopens and dismisses the setup guide', async () => {
  const calls = [];
  const driver = {
    waitForVisible(selector) { calls.push(['visible', selector]); },
    waitForHidden(selector) { calls.push(['hidden', selector]); },
    click(selector) { calls.push(['click', selector]); },
    assertNoHorizontalOverflow(stage) { calls.push(['overflow', stage]); },
  };

  await runReopenedSetupFlow(driver);

  assert.deepEqual(calls, [
    ['visible', SETUP_FLOW_SELECTORS.reopen],
    ['click', SETUP_FLOW_SELECTORS.reopen],
    ['visible', SETUP_FLOW_SELECTORS.guide],
    ['overflow', 'reopened setup guide'],
    ['click', SETUP_FLOW_SELECTORS.dismiss],
    ['hidden', SETUP_FLOW_SELECTORS.welcome],
    ['visible', SETUP_FLOW_SELECTORS.workbench],
  ]);
});

test('adapts the setup flow contract to Playwright locators and browser state', async () => {
  const calls = [];
  const page = {
    locator(selector) {
      return {
        waitFor(options) { calls.push(['wait', selector, options]); },
        click() { calls.push(['click', selector]); },
        innerText() { calls.push(['text', selector]); return 'install command'; },
      };
    },
    waitForFunction(_predicate, value) { calls.push(['waitForFunction', value]); },
    evaluate(_callback, argument) {
      calls.push(['evaluate', argument]);
      return argument === undefined ? 'install command' : 'true';
    },
  };
  const driver = createPlaywrightSetupDriver(page, 'mobile', {
    assertNoOverflow(_page, label) { calls.push(['overflow', label]); },
  });

  await driver.waitForVisible('#welcome');
  await driver.waitForHidden('#welcome');
  await driver.click('#copy');
  assert.equal(await driver.readText('#command'), 'install command');
  await driver.waitForLocale('zh-CN');
  await driver.expectClipboard('install command');
  await driver.expectStoredValue('seen', 'true');
  await driver.assertNoHorizontalOverflow('setup welcome');

  assert.deepEqual(calls, [
    ['wait', '#welcome', { state: 'visible', timeout: 5000 }],
    ['wait', '#welcome', { state: 'hidden', timeout: 5000 }],
    ['click', '#copy'],
    ['text', '#command'],
    ['waitForFunction', 'zh-CN'],
    ['waitForFunction', { expectedValue: 'install command' }],
    ['evaluate', { storageKey: 'seen', expectedValue: 'true' }],
    ['overflow', 'mobile setup welcome'],
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

test('can delay mock job polling for deterministic stop and resume coverage', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'sandkasten-browser-smoke-delay-'));
  const distDir = path.join(root, 'dist');
  await mkdir(distDir);
  for (const name of ['index.html', 'app.js', 'styles.css', 'config.js']) {
    await writeFile(path.join(distDir, name), '');
  }

  const app = await createMockAppServer({ distDir, jobPollDelayMs: 25 });
  t.after(() => app.close());
  const submitted = await fetch(`${app.url}v1/python/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: 'print("delay")' }),
  }).then((response) => response.json());
  const startedAt = performance.now();
  const response = await fetch(`${app.url}v1/jobs/${submitted.jobId}`);
  const elapsedMs = performance.now() - startedAt;

  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, 'JOB_STATUS_RUNNING');
  assert.ok(elapsedMs >= 15, `mock polling delay was ${elapsedMs.toFixed(1)}ms`);
});
