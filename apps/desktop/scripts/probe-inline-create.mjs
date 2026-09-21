#!/usr/bin/env node
// Drive the real desktop shell to the inline creation row and capture it. This
// is a visual check, not a substitute for the end-to-end suite: it opens the
// row with a nested file selected and records where the row landed.
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const appRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname.slice(1)), '..');
const repositoryRoot = path.resolve(appRoot, '..', '..');

// The desktop package has no playwright dependency of its own; the WebUI
// worktree provides drive-core for the end-to-end runs, and this probe reuses
// the same resolution so both always drive the same driver.
async function loadElectronDriver() {
  const candidates = [
    path.join(appRoot, '..', 'web', 'node_modules', 'playwright-core', 'index.js'),
    path.join(appRoot, 'node_modules', 'playwright-core', 'index.js'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      const module = await import(pathToFileURL(candidate).href);
      return module._electron ?? module.default?._electron ?? module.default;
    }
  }
  throw new Error('playwright-core is required for the inline probe; install WebUI dependencies first');
}
const electron = await loadElectronDriver();
const outputRoot = path.join(repositoryRoot, 'tmp', 'inline-create-probe');
await mkdir(outputRoot, { recursive: true });

const workspace = await mkdtemp(path.join(os.tmpdir(), 'sandkasten-inline-'));
await mkdir(path.join(workspace, 'pkg', 'deep'), { recursive: true });
await writeFile(path.join(workspace, 'pkg', 'deep', 'util.py'), 'print("util")' + String.fromCharCode(10));
await writeFile(path.join(workspace, 'pkg', 'notes.md'), '# notes' + String.fromCharCode(10));
await writeFile(path.join(workspace, 'main.py'), 'print("main")' + String.fromCharCode(10));

const executable = process.env.SANDKASTEN_E2E_EXECUTABLE;
const electronExecutable = executable
  ?? (await import(pathToFileURL(path.join(appRoot, 'node_modules', 'electron', 'index.js')).href)).default;
// The opened folder arrives through the environment, exactly as the end-to-end
// run passes it; the flag form this probe used first is not one the app reads.
const profileArgument = '--user-data-dir=' + path.join(workspace, '..', 'profile');
const launchArgs = executable
  ? [profileArgument]
  : [appRoot, profileArgument];
const app = await electron.launch({
  executablePath: electronExecutable,
  args: launchArgs,
  env: { ...process.env, SANDKASTEN_WORKSPACE_ROOT: workspace, SANDKASTEN_E2E_PROBE: '1' },
  cwd: appRoot,
});
const page = await app.firstWindow();
// A fresh profile opens the first-visit setup, which covers the workbench until
// it is dismissed; the end-to-end run dismisses it the same way.
await page.waitForSelector('[data-testid="app-shell"]', { timeout: 30000 });
if (await page.locator('[data-testid="setup-dismiss"]').count()) {
  await page.click('[data-testid="setup-dismiss"]');
}
await page.waitForSelector('[data-testid="workspace-explorer"]', { timeout: 30000 });

const report = { workspace, steps: [] };
const shot = async (name) => {
  const file = path.join(outputRoot, name + '.png');
  await page.screenshot({ path: file });
  report.steps.push({ name, file });
};

// The tree lists every directory open by default, so nothing needs unfolding;
// clicking a toggle here would fold the directory the probe wants to reach.
await page.waitForSelector('[data-path="pkg/deep/util.py"]', { timeout: 10000 });
report.deepVisibleAfterExpand = await page.locator('[data-path="pkg/deep"]').count();
await page.click('[data-path="pkg/deep/util.py"] .ide-tree__open');
await page.waitForTimeout(300);
report.openedTab = await page.locator('.ide-tab__name').allInnerTexts();

await page.click('[data-action="ide-new-file"]');
await page.waitForSelector('[data-testid="ide-new-file-form"]', { timeout: 10000 });
report.newFileRow = await page.evaluate(() => {
  const row = document.querySelector('[data-testid="ide-inline-create"]');
  const tree = document.querySelector('.ide-tree');
  const treeRows = Array.from(document.querySelectorAll('.ide-tree__row'));
  const index = treeRows.indexOf(row);
  const previous = index > 0 ? treeRows[index - 1].closest('[data-path]') : null;
  return {
    parent: row ? row.getAttribute('data-parent') : null,
    depth: row ? row.getAttribute('data-depth') : null,
    kind: row ? row.getAttribute('data-kind') : null,
    insideTree: Boolean(row && tree && tree.contains(row)),
    rowIndex: index,
    rowCount: treeRows.length,
    previousRowPath: previous ? previous.getAttribute('data-path') : null,
    hasFolderField: Boolean(document.querySelector('input[name="fileFolder"]')),
  };
});
await shot('new-file-row');

await page.fill('input[name="fileName"]', 'helper.py');
await page.click('[data-action="ide-create-file"]');
await page.waitForSelector('[data-path="pkg/deep/helper.py"]', { timeout: 10000 });
report.createdFileRow = await page.locator('[data-path="pkg/deep/helper.py"]').count();
await shot('created-file');

await page.click('[data-action="ide-new-folder"]');
await page.waitForSelector('[data-testid="ide-new-folder-form"]', { timeout: 10000 });
report.newFolderRow = await page.evaluate(() => {
  const row = document.querySelector('[data-testid="ide-inline-create"]');
  const input = document.querySelector('[data-testid="ide-inline-create"] input');
  return {
    parent: row ? row.getAttribute('data-parent') : null,
    depth: row ? row.getAttribute('data-depth') : null,
    kind: row ? row.getAttribute('data-kind') : null,
    inputName: input ? input.getAttribute('name') : null,
  };
});
await shot('new-folder-row');

await page.fill('input[name="folderName"]', 'generated');
await page.click('[data-action="ide-create-folder"]');
await page.waitForSelector('[data-path="pkg/deep/generated"]', { timeout: 10000 });
report.createdFolderRow = await page.locator('[data-path="pkg/deep/generated"]').count();
await shot('created-folder');

await app.close();
process.stdout.write(JSON.stringify(report, null, 2) + String.fromCharCode(10));
