import assert from 'node:assert/strict';
import { mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  VIEWPORTS,
  createMockAppServer,
  findBrowserExecutable,
  inspectScreenshot,
  loadPlaywrightChromium,
  measurePixelDifference,
} from './webui-browser-smoke-lib.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');
const distDir = path.join(repositoryRoot, 'webui', 'dist');
const screenshotDirectory = path.resolve(
  process.env.SANDKASTEN_SMOKE_OUTPUT_DIR || path.join(repositoryRoot, 'tmp', 'webui-browser-smoke'),
);
const distributionFiles = ['app.js', 'config.js', 'index.html', 'styles.css'];

function log(message) {
  process.stdout.write('[webui-browser-smoke] ' + message + '\n');
}

async function verifyDistribution() {
  const entries = await readdir(distDir, { withFileTypes: true });
  const names = entries.map((entry) => entry.name).sort();
  assert.deepEqual(names, distributionFiles.slice().sort(), 'webui/dist must contain exactly four files');
  assert.ok(entries.every((entry) => entry.isFile()), 'webui/dist entries must be regular files');
}

async function assertNoHorizontalOverflow(page, viewportName) {
  const dimensions = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
  }));
  assert.ok(
    dimensions.documentWidth <= dimensions.innerWidth + 1 && dimensions.bodyWidth <= dimensions.innerWidth + 1,
    viewportName + ' has horizontal overflow: ' + JSON.stringify(dimensions),
  );
}

async function assertMainRegions(page, viewportName) {
  const selector = '[aria-label="Source workbench"], [aria-label="Editor"], [aria-label="Result output"], select[aria-label="Runtime"]';
  const regions = await page.locator(selector).evaluateAll((elements) => elements.map((element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      label: element.getAttribute('aria-label') || element.tagName,
      width: rect.width,
      height: rect.height,
      display: style.display,
      visibility: style.visibility,
    };
  }));
  assert.equal(regions.length, 4, viewportName + ' should expose all primary regions');
  for (const region of regions) {
    assert.ok(region.width > 0 && region.height > 0, viewportName + ' region is empty: ' + JSON.stringify(region));
    assert.notEqual(region.display, 'none', viewportName + ' region is display:none: ' + JSON.stringify(region));
    assert.notEqual(region.visibility, 'hidden', viewportName + ' region is hidden: ' + JSON.stringify(region));
  }
}

async function assertNoIntersectingControls(page, viewportName) {
  const intersections = await page.evaluate(() => {
    const controls = Array.from(document.querySelectorAll('button, select, textarea, [role="tab"]'))
      .filter((element) => {
        if (!(element instanceof HTMLElement)) return false;
        if (element.closest('.edge-sheet__backdrop')) return false;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
      });
    const pairs = [];
    for (let firstIndex = 0; firstIndex < controls.length; firstIndex += 1) {
      const first = controls[firstIndex];
      const firstRect = first.getBoundingClientRect();
      for (let secondIndex = firstIndex + 1; secondIndex < controls.length; secondIndex += 1) {
        const second = controls[secondIndex];
        if (first.contains(second) || second.contains(first)) continue;
        const secondRect = second.getBoundingClientRect();
        const overlapWidth = Math.min(firstRect.right, secondRect.right) - Math.max(firstRect.left, secondRect.left);
        const overlapHeight = Math.min(firstRect.bottom, secondRect.bottom) - Math.max(firstRect.top, secondRect.top);
        if (overlapWidth > 1 && overlapHeight > 1) {
          pairs.push({
            first: first.getAttribute('aria-label') || first.textContent.trim(),
            second: second.getAttribute('aria-label') || second.textContent.trim(),
          });
        }
      }
    }
    return pairs;
  });
  assert.deepEqual(intersections, [], viewportName + ' has overlapping controls: ' + JSON.stringify(intersections));
}

async function assertScreenshot(page, name, expectedWidth, expectedHeight) {
  const filePath = path.join(screenshotDirectory, name + '.png');
  const buffer = await page.screenshot({ path: filePath, fullPage: false });
  const metrics = inspectScreenshot(buffer);
  assert.equal(metrics.width, expectedWidth, name + ' screenshot width mismatch');
  assert.equal(metrics.height, expectedHeight, name + ' screenshot height mismatch');
  assert.ok(metrics.opaquePixels > metrics.width * metrics.height * 0.35, name + ' screenshot is mostly transparent/blank');
  assert.ok(metrics.distinctColors >= 8, name + ' screenshot lacks visual detail');
  return { filePath, buffer, metrics };
}

async function waitForConnected(page) {
  await page.getByText('Connected', { exact: true }).waitFor({ state: 'visible', timeout: 5000 });
  await page.locator('[aria-label="Editor"] .cm-content').waitFor({ state: 'visible', timeout: 5000 });
}

async function enterSource(page) {
  const editor = page.locator('[aria-label="Editor"] .cm-content');
  await editor.click();
  await page.keyboard.insertText('print("browser smoke")');
  await page.getByRole('button', { name: 'Run source' }).waitFor({ state: 'visible', timeout: 2000 });
}

async function runAndInspectOutput(page, viewportName) {
  await enterSource(page);
  await page.getByRole('button', { name: 'Run source' }).click();
  const stopButton = page.getByRole('button', { name: 'Stop polling' });
  await stopButton.waitFor({ state: 'visible', timeout: 3000 });
  await stopButton.click();
  await page.getByRole('button', { name: 'Resume polling' }).waitFor({ state: 'visible', timeout: 2000 });
  await page.getByText('Monitoring stopped. The job may still be running.', { exact: true }).waitFor({ state: 'visible', timeout: 2000 });
  await page.getByRole('button', { name: 'Resume polling' }).click();
  const timeline = page.locator('[aria-label="Job timeline"]');
  await timeline.getByText('Succeeded', { exact: true }).waitFor({ state: 'visible', timeout: 8000 });
  await page.getByText('browser smoke output', { exact: false }).waitFor({ state: 'visible', timeout: 2000 });
  await page.getByRole('tab', { name: /Errors/ }).click();
  await page.getByText('browser smoke stderr', { exact: true }).waitFor({ state: 'visible', timeout: 2000 });
  await page.getByRole('tab', { name: /^Output/ }).click();
  const outputRegion = page.locator('[aria-label="Result output"]');
  await outputRegion.getByText('browser smoke output', { exact: false }).waitFor({ state: 'visible', timeout: 2000 });
  const outputText = await outputRegion.innerText();
  assert.match(outputText, /<em>rendered as text<\/em>/, viewportName + ' output was not rendered as text');
  assert.equal(await outputRegion.locator('em').count(), 0, viewportName + ' output injected API text as HTML');
}

async function inspectCompactSheets(page, viewportName) {
  await page.getByRole('button', { name: 'Show history' }).click();
  const historyDialog = page.getByRole('dialog', { name: 'Recent runs' });
  await historyDialog.waitFor({ state: 'visible', timeout: 2000 });
  assert.ok(await historyDialog.getByText('python', { exact: true }).count(), viewportName + ' history sheet has no run');
  await page.getByRole('button', { name: 'Close Recent runs' }).click();
  await historyDialog.waitFor({ state: 'hidden', timeout: 2000 });
  await page.getByRole('button', { name: 'Show inspector' }).click();
  const inspectorDialog = page.getByRole('dialog', { name: 'Inspector' });
  await inspectorDialog.waitFor({ state: 'visible', timeout: 2000 });
  assert.ok(await inspectorDialog.getByText('Runtime', { exact: true }).count(), viewportName + ' inspector sheet has no runtime section');
  await page.keyboard.press('Escape');
  await inspectorDialog.waitFor({ state: 'hidden', timeout: 2000 });
}

async function inspectViewport(browser, appUrl, viewport) {
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(appUrl).origin });
  const page = await context.newPage();
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await page.goto(appUrl, { waitUntil: 'networkidle' });
  await waitForConnected(page);
  await assertMainRegions(page, viewport.name);
  await assertNoHorizontalOverflow(page, viewport.name);
  await assertNoIntersectingControls(page, viewport.name);
  await runAndInspectOutput(page, viewport.name);
  if (viewport.name !== 'desktop') await inspectCompactSheets(page, viewport.name);
  const light = await assertScreenshot(page, viewport.name, viewport.width, viewport.height);
  await page.getByRole('button', { name: 'Use dark theme' }).click();
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await assertNoHorizontalOverflow(page, viewport.name + ' dark theme');
  const dark = await assertScreenshot(page, viewport.name + '-dark', viewport.width, viewport.height);
  const difference = measurePixelDifference(light.buffer, dark.buffer);
  assert.ok(difference.ratio > 0.01, viewport.name + ' theme toggle did not change screenshot pixels: ' + JSON.stringify(difference));
  await context.close();
  return { light, dark, difference };
}

async function main() {
  await verifyDistribution();
  await mkdir(screenshotDirectory, { recursive: true });
  const executablePath = findBrowserExecutable();
  if (!executablePath) throw new Error('No Chrome/Edge executable found. Set SANDKASTEN_BROWSER_PATH to a local browser binary.');
  log('using browser ' + executablePath);
  const app = await createMockAppServer({ distDir, jobSequence: ['JOB_STATUS_RUNNING', 'JOB_STATUS_RUNNING', 'JOB_STATUS_SUCCEEDED'], jobPollDelayMs: 250 });
  const chromium = loadPlaywrightChromium({ webuiDirectory: path.join(repositoryRoot, 'webui') });
  const browser = await chromium.launch({ executablePath, headless: true, args: ['--disable-gpu', '--disable-dev-shm-usage'] });
  try {
    const results = [];
    for (const viewport of VIEWPORTS) {
      log('checking ' + viewport.name + ' ' + viewport.width + 'x' + viewport.height);
      results.push(await inspectViewport(browser, app.url, viewport));
    }
    const screenshots = await readdir(screenshotDirectory);
    assert.ok(screenshots.length >= VIEWPORTS.length * 2, 'expected light and dark screenshots for each viewport');
    log('passed ' + results.length + ' viewports; screenshots: ' + screenshotDirectory);
  } finally {
    await browser.close();
    await app.close();
  }
}

main().catch((error) => {
  process.stderr.write('[webui-browser-smoke] ' + (error instanceof Error ? error.stack : String(error)) + '\n');
  process.exitCode = 1;
});
