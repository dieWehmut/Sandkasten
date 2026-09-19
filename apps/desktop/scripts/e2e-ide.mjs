#!/usr/bin/env node
// End-to-end verification of the desktop IDE: launches the real Electron main
// process against a temporary workspace, drives the built WebUI, runs a file
// with the local toolchain, and captures screenshots. Playwright's Electron
// driver lives in the web app because it is already a WebUI dev dependency.
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { existsSync, statSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = path.resolve(appRoot, '..', '..');
const outputRoot = path.join(repositoryRoot, 'tmp');

function hasPython() {
  const probe = spawnSync(process.platform === 'win32' ? 'python' : 'python3', ['--version'], { stdio: 'ignore' });
  return probe.status === 0;
}

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
  throw new Error('playwright-core is required for the desktop E2E run; install WebUI dependencies first');
}

async function main() {
  if (!hasPython()) {
    throw new Error('the desktop E2E run needs python on PATH to execute a local file');
  }
  const driver = await loadElectronDriver();
  const electronExecutable = (await import('electron')).default;

  const testRoot = await mkdtemp(path.join(os.tmpdir(), 'sandkasten-e2e-'));
  const workspace = path.join(testRoot, 'workspace');
  await mkdir(workspace);
  await mkdir(path.join(workspace, 'pkg'), { recursive: true });
  await mkdir(path.join(workspace, 'many'), { recursive: true });
  await writeFile(path.join(workspace, 'hello.py'), 'print("E2E-LOCAL-RUN-OK")\n');
  await writeFile(path.join(workspace, 'sandboxed.py'), [
    'import os, socket',
    'print("E2E-ISOLATED-RUN-OK", os.getpid() == 1)',
    'try:',
    '    socket.create_connection(("1.1.1.1", 53), timeout=2)',
    '    print("E2E-NETWORK-OPEN")',
    'except OSError:',
    '    print("E2E-NETWORK-BLOCKED")',
  ].join('\n') + '\n');
  await writeFile(path.join(workspace, 'pkg', 'util.py'), 'print("util-ok")\n');
  await writeFile(path.join(workspace, 'notes.md'), '# notes\n');
  const longFile = ['for index in range(200):', '    print(f"line {index:03d}")'];
  for (let index = 0; index < 200; index += 1) longFile.push(`# padding line ${index}`);
  await writeFile(path.join(workspace, 'long.py'), `${longFile.join('\n')}\n`);
  for (let index = 0; index < 60; index += 1) {
    await writeFile(path.join(workspace, 'many', `file-${String(index).padStart(2, '0')}.py`), `print(${index})\n`);
  }
  await mkdir(path.join(outputRoot), { recursive: true });

  const packagedExecutable = process.env.SANDKASTEN_E2E_EXECUTABLE;
  const profileArgument = `--user-data-dir=${path.join(testRoot, 'profile')}`;
  const app = packagedExecutable
    ? await driver.launch({ executablePath: packagedExecutable, args: [profileArgument], env: { ...process.env, SANDKASTEN_WORKSPACE_ROOT: workspace } })
    : await driver.launch({ executablePath: electronExecutable, args: ['.', profileArgument], cwd: appRoot, env: { ...process.env, SANDKASTEN_WORKSPACE_ROOT: workspace } });

  const checks = { workspace, python: true, mode: packagedExecutable ? 'packaged' : 'development' };
  let failure;
  try {
    const page = await app.firstWindow();
    const consoleMessages = [];
    page.on('console', (message) => consoleMessages.push(`${message.type()}: ${message.text()}`));
    page.on('pageerror', (error) => consoleMessages.push(`pageerror: ${error.message}`));
    checks.consoleMessages = consoleMessages;

    await page.waitForSelector('[data-testid="app-shell"]', { timeout: 30_000 });
    if (await page.locator('[data-testid="setup-dismiss"]').count()) {
      await page.click('[data-testid="setup-dismiss"]');
      checks.setupGuideDismissed = true;
    }
    await page.waitForSelector('[data-testid="workbench-shell"]', { timeout: 30_000 });
    // The window hides its native title bar, so the renderer owns the whole
    // title row: the five application menus, the composed window title, and
    // the native menu popup that opens below the clicked button.
    {
      await page.waitForSelector('[data-testid="desktop-menu"]', { timeout: 20_000 });
      checks.titleRow = await page.evaluate(() => {
        const header = document.querySelector('[data-testid="app-header"]');
        const buttons = Array.from(document.querySelectorAll('[data-testid="desktop-menu"] .desktop-menu__button'));
        const rect = header?.getBoundingClientRect();
        return {
          headerIntegrated: header?.classList.contains('app-header--integrated') ?? false,
          headerHeight: Math.round(rect?.height ?? 0),
          dragRegion: header ? getComputedStyle(header).webkitAppRegion : null,
          menus: buttons.map((button) => button.textContent?.trim()),
          title: document.querySelector('[data-testid="window-title"]')?.textContent?.trim() ?? null,
        };
      });
      const runButton = page.locator('[data-menu="run"]');
      const runBox = await runButton.boundingBox();
      await runButton.click();
      await page.waitForFunction(() => document.querySelector('[data-menu="run"]')?.getAttribute('aria-expanded') === 'true', null, { timeout: 10_000 });
      checks.titleRowMenu = { anchorX: Math.round(runBox?.x ?? 0), expanded: true };
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => document.querySelector('[data-menu="run"]')?.getAttribute('aria-expanded') === 'false', null, { timeout: 10_000 });
      checks.titleRowMenu.dismissed = true;
    }

    const ensureTheme = async (theme) => {
      if ((await page.getAttribute('html', 'data-theme')) === theme) return;
      await page.click('[data-action="toggle-theme"]');
      await page.waitForFunction((expected) => document.documentElement.dataset.theme === expected, theme, { timeout: 5_000 });
    };

    checks.bridgeExposed = await page.evaluate(() => typeof window.sandkastenDesktop?.workspace?.read === 'function');
    checks.workspaceRoot = await page.evaluate(() => window.sandkastenDesktop?.workspace?.root?.() ?? null);
    checks.bridgeTree = await page.evaluate(() => window.sandkastenDesktop?.workspace?.list?.() ?? null);
    checks.menu = await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.items.map((item) => item.label) ?? []);
    await page.waitForFunction(() => document.querySelector('[data-testid="ide-status-bar"]')?.dataset.backend === 'local', null, { timeout: 30_000 });
    checks.backend = await page.getAttribute('[data-testid="ide-status-bar"]', 'data-backend');
    checks.localRuntimes = await page.evaluate(async () => (await window.sandkastenDesktop.runner.detect()).filter((entry) => entry.available).map((entry) => entry.language));
    checks.activityButtons = await page.locator('.ide-activity__button').count();
    checks.explorerRows = await page.locator('.ide-tree__row').count();
    checks.tree = await page.locator('.ide-tree__name').allInnerTexts();
    checks.bodyPreview = (await page.locator('.ide-sidebar').innerText().catch(() => '')).slice(0, 200);

    await page.click('[data-path="hello.py"] .ide-tree__open');
    await page.waitForSelector('[data-action="ide-tab-hello.py"]');
    checks.activeTab = (await page.locator('.ide-tab--active .ide-tab__name').innerText()).trim();
    // The window names the open file and workspace, which is how the shell
    // titles itself in the OS task bar and window list.
    checks.windowTitle = await page.title();
    checks.editorText = (await page.locator('.cm-content').innerText()).trim();

    await page.click('[data-action="run-source"]');
    await page.waitForFunction(() => document.body.innerText.includes('E2E-LOCAL-RUN-OK'), null, { timeout: 30_000 });
    checks.localRunOutput = (await page.locator('.output-viewer pre').first().innerText()).trim();
    checks.localRunPhase = (await page.locator('[data-testid="ide-status-phase"]').innerText()).trim();
    checks.localRunBackendBadge = (await page.locator('.ide-status__badge').innerText()).trim();

    // The isolated backend must be offered only when WSL2 can actually create
    // the namespaces, and a run through it must execute the file in the sandbox.
    checks.isolationStatus = await page.evaluate(() => window.sandkastenDesktop?.isolated?.detect?.() ?? null);
    checks.isolatedOptionDisabled = await page.getAttribute('[data-testid="ide-backend-select"] option[value="isolated"]', 'disabled') !== null;
    if (checks.isolationStatus?.available) {
      await page.selectOption('[data-testid="ide-backend-select"]', 'isolated');
      await page.waitForFunction(() => document.querySelector('[data-testid="ide-status-bar"]')?.dataset.backend === 'isolated', null, { timeout: 10_000 });
      await page.click('[data-path="sandboxed.py"] .ide-tree__open');
      await page.waitForSelector('[data-action="ide-tab-sandboxed.py"]');
      await page.click('[data-action="run-source"]');
      await page.waitForFunction(() => document.body.innerText.includes('E2E-ISOLATED-RUN-OK'), null, { timeout: 180_000 });
      checks.isolatedRunOutput = (await page.locator('.output-viewer pre').first().innerText()).trim();
      checks.isolatedRunPhase = (await page.locator('[data-testid="ide-status-phase"]').innerText()).trim();
      checks.isolatedRunBackendBadge = (await page.locator('.ide-status__badge').innerText()).trim();
      await page.selectOption('[data-testid="ide-backend-select"]', 'local');
      await page.waitForFunction(() => document.querySelector('[data-testid="ide-status-bar"]')?.dataset.backend === 'local', null, { timeout: 10_000 });
      await page.click('[data-path="hello.py"] .ide-tree__open');
      await page.waitForSelector('[data-action="ide-tab-hello.py"]');
    }

    await page.click('.cm-content');
    await page.keyboard.press('Control+a');
    await page.keyboard.type('print("E2E-SAVED")\n');
    await page.waitForSelector('.ide-tab__dirty');
    await page.keyboard.press('Control+s');
    await page.waitForFunction(() => !document.querySelector('.ide-tab__dirty'), null, { timeout: 10_000 });
    checks.savedFile = (await readFile(path.join(workspace, 'hello.py'), 'utf8')).trim();
    checks.savedRemotely = checks.savedFile === 'print("E2E-SAVED")';

    await page.keyboard.press('Control+n');
    await page.waitForSelector('[data-testid="ide-new-file-form"]');
    await page.fill('input[name="fileName"]', 'extra.py');
    await page.click('[data-action="ide-create-file"]');
    await page.waitForSelector('[data-path="extra.py"]');
    checks.createdOnDisk = existsSync(path.join(workspace, 'extra.py'));
    checks.openTabs = await page.locator('.ide-tab__name').allInnerTexts();

    await page.keyboard.press('Control+j');
    await page.waitForFunction(() => !document.querySelector('.ide-panel'), null, { timeout: 5_000 });
    checks.panelHidden = (await page.locator('.ide-panel').count()) === 0;
    await page.keyboard.press('Control+j');
    await page.waitForSelector('.ide-panel');

    checks.rowsBeforeCollapse = await page.locator('.ide-tree__row').count();
    const toggle = page.locator('[data-path="pkg"] .ide-tree__toggle');
    checks.toggleExpandedBefore = await toggle.getAttribute('aria-expanded');
    await toggle.click();
    await page.waitForTimeout(300);
    checks.toggleExpandedAfter = await toggle.getAttribute('aria-expanded');
    checks.utilRowAfterCollapse = await page.locator('[data-path="pkg/util.py"]').count();
    checks.collapsedRows = await page.locator('.ide-tree__row').count();
    if (checks.utilRowAfterCollapse === 0) {
      await toggle.click();
      await page.waitForSelector('[data-path="pkg/util.py"]');
    }

    // The collapse control must live in the sidebar header, flush with its
    // top-right corner, and must hide the whole sidebar.
    checks.collapseButton = await page.evaluate(() => {
      const button = document.querySelector('[data-action="ide-collapse-sidebar"]');
      const header = document.querySelector('.ide-sidebar__header');
      const sidebar = document.querySelector('.ide-sidebar');
      if (!button || !header || !sidebar) return null;
      const rects = { button: button.getBoundingClientRect(), header: header.getBoundingClientRect(), sidebar: sidebar.getBoundingClientRect() };
      const buttons = Array.from(header.querySelectorAll('button'));
      return {
        insideHeader: header.contains(button),
        lastControl: buttons.at(-1) === button,
        topAligned: Math.abs(rects.button.top - rects.sidebar.top) <= 12,
        rightGap: Math.round(rects.sidebar.right - rects.button.right),
        verticalGap: Math.round(rects.button.top - rects.sidebar.top),
        order: buttons.map((entry) => entry.getAttribute('data-action')),
      };
    });
    await page.click('[data-action="ide-collapse-sidebar"]');
    await page.waitForFunction(() => !document.querySelector('.ide-sidebar'), null, { timeout: 5_000 });
    checks.sidebarHiddenByButton = (await page.locator('.ide-sidebar').count()) === 0;
    await page.keyboard.press('Control+b');
    await page.waitForSelector('.ide-sidebar');

    // The wheel must scroll whatever pane is under the cursor.
    const scrollTop = (selector) => page.evaluate((target) => document.querySelector(target)?.scrollTop ?? -1, selector);
    const wheelOver = async (selector, delta) => {
      const box = await page.locator(selector).first().boundingBox();
      if (!box) return -1;
      await page.mouse.move(box.x + box.width / 2, box.y + Math.min(box.height / 2, 120));
      await page.mouse.wheel(0, delta);
      await page.waitForTimeout(250);
      return scrollTop(selector);
    };

    checks.treeScrollable = await page.evaluate(() => {
      const tree = document.querySelector('.ide-tree');
      return Boolean(tree) && tree.scrollHeight > tree.clientHeight;
    });
    checks.treeScrollTop = await wheelOver('.ide-tree', 400);
    checks.documentScrollY = await page.evaluate(() => window.scrollY);

    await page.click('[data-path="long.py"] .ide-tree__open');
    await page.waitForSelector('[data-action="ide-tab-long.py"]');
    checks.editorScrollable = await page.evaluate(() => {
      const scroller = document.querySelector('.ide-editor .cm-scroller');
      return Boolean(scroller) && scroller.scrollHeight > scroller.clientHeight;
    });
    checks.longEditor = await page.evaluate(() => {
      const scroller = document.querySelector('.ide-editor .cm-scroller');
      return {
        activeTab: document.querySelector('.ide-tab--active .ide-tab__name')?.textContent?.trim(),
        client: scroller?.clientHeight,
        scroll: scroller?.scrollHeight,
        lines: document.querySelectorAll('.ide-editor .cm-line').length,
        firstLine: document.querySelector('.ide-editor .cm-line')?.textContent,
      };
    });
    checks.editorScrollTop = await wheelOver('.ide-editor .cm-scroller', 400);

    // The minimap overviews the whole file, so it must exist for a long file
    // and must actually paint instead of staying an empty column.
    checks.minimap = await page.evaluate(() => {
      const gutter = document.querySelector('.ide-editor .cm-minimap-gutter');
      const canvas = gutter?.querySelector('canvas');
      if (!gutter || !canvas) return { present: false };
      const box = gutter.getBoundingClientRect();
      let painted = false;
      try {
        const context = canvas.getContext('2d');
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        for (let index = 3; index < pixels.length; index += 4) {
          if (pixels[index] !== 0) { painted = true; break; }
        }
      } catch {
        painted = null;
      }
      return { present: true, width: Math.round(box.width), painted };
    });

    await page.click('[data-action="run-source"]');
    await page.waitForFunction(() => document.body.innerText.includes('line 199'), null, { timeout: 30_000 });
    checks.panelScrollable = await page.evaluate(() => {
      const panel = document.querySelector('.ide-panel');
      return Boolean(panel) && panel.scrollHeight > panel.clientHeight;
    });
    checks.panelScrollTop = await wheelOver('.ide-panel', 400);

    // The smallest allowed window keeps every region reachable: the document
    // itself must not grow, and the status bar stays pinned to the viewport.
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      if (window) window.setSize(1280, 640);
    });
    await page.waitForTimeout(500);
    checks.minimumWindow = await page.evaluate(() => {
      const status = document.querySelector('.ide-status');
      const body = document.querySelector('.ide-body');
      const tree = document.querySelector('.ide-tree');
      if (!status || !body) return null;
      const statusRect = status.getBoundingClientRect();
      return {
        viewportHeight: window.innerHeight,
        documentHeight: document.documentElement.scrollHeight,
        statusBottom: Math.round(statusRect.bottom),
        statusVisible: statusRect.bottom <= window.innerHeight + 1 && statusRect.top >= 0,
        documentBounded: document.documentElement.scrollHeight <= window.innerHeight + 1,
        treeScrollable: Boolean(tree) && tree.scrollHeight > tree.clientHeight,
        bodyOverflowing: body.scrollHeight > body.clientHeight,
      };
    });
    checks.minimumWindowBodyScrollTop = await scrollTop('.ide-body');
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      if (window) window.setSize(1280, 860);
    });
    await page.waitForTimeout(400);

    // Pink is the default accent; nothing may randomize it on a fresh start.
    await page.evaluate(() => window.localStorage.removeItem('sandkasten-color-scheme'));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="workbench-shell"]');
    if (await page.locator('[data-testid="setup-dismiss"]').count()) await page.click('[data-testid="setup-dismiss"]');
    await page.waitForSelector('[data-testid="workbench-shell"]');
    checks.colorScheme = await page.getAttribute('html', 'data-color-scheme');
    checks.theme = await page.getAttribute('html', 'data-theme');
    checks.defaultAccentByTheme = {};
    for (const theme of ['light', 'dark']) {
      await ensureTheme(theme);
      checks.defaultAccentByTheme[theme] = await page.evaluate(() => ({
        accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
        strong: getComputedStyle(document.documentElement).getPropertyValue('--accent-strong').trim(),
        canvas: getComputedStyle(document.documentElement).getPropertyValue('--canvas').trim(),
      }));
    }
    checks.storedColorScheme = await page.evaluate(() => window.localStorage.getItem('sandkasten-color-scheme'));

    await ensureTheme('light');
    checks.lightTheme = await page.getAttribute('html', 'data-theme');
    checks.lightSyntaxColors = await page.evaluate(() => Array.from(document.querySelectorAll('.ide-editor .cm-line span'))
      .slice(0, 5)
      .map((span) => ({ text: span.textContent, color: getComputedStyle(span).color })));
    const lightShot = path.join(outputRoot, 'desktop-ide-light.png');
    await page.screenshot({ path: lightShot });
    checks.lightScreenshot = lightShot;
    checks.lightScreenshotBytes = statSync(lightShot).size;

    checks.layout = await page.evaluate(() => {
      const rect = (selector) => {
        const element = document.querySelector(selector);
        if (!element) return null;
        const box = element.getBoundingClientRect();
        return { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height) };
      };
      const colour = (selector) => {
        const element = document.querySelector(selector);
        return element ? getComputedStyle(element).backgroundColor : null;
      };
      const pageElement = document.documentElement;
      return {
        viewport: { w: window.innerWidth, h: window.innerHeight },
        activity: rect('.ide-activity'),
        sidebar: rect('.ide-sidebar'),
        tabs: rect('.ide-tabs'),
        toolbar: rect('.ide-toolbar'),
        editor: rect('.ide-editor'),
        codeMirror: rect('.ide-editor .cm-editor'),
        panel: rect('.ide-panel'),
        status: rect('.ide-status'),
        activityBackground: colour('.ide-activity'),
        editorBackground: colour('.ide-editor .cm-editor'),
        panelBackground: colour('.ide-panel'),
        statusBackground: colour('.ide-status'),
        documentTheme: document.documentElement.dataset.theme,
        systemPrefersDark: window.matchMedia('(prefers-color-scheme: dark)').matches,
        fullHeight: Math.abs((rect('.ide-main')?.h ?? 0) + (rect('.app-header')?.h ?? 0) - window.innerHeight) <= 1,
        noPageScroll: pageElement.scrollHeight <= window.innerHeight + 1 && pageElement.scrollWidth <= window.innerWidth + 1,
      };
    });

    await ensureTheme('dark');
    checks.darkTheme = await page.getAttribute('html', 'data-theme');
    checks.darkSyntaxColors = await page.evaluate(() => Array.from(document.querySelectorAll('.ide-editor .cm-line span'))
      .slice(0, 5)
      .map((span) => ({ text: span.textContent, color: getComputedStyle(span).color })));
    const darkShot = path.join(outputRoot, 'desktop-ide-dark.png');
    await page.screenshot({ path: darkShot });
    checks.darkScreenshot = darkShot;
    checks.darkScreenshotBytes = statSync(darkShot).size;
    checks.darkStatusBackground = await page.evaluate(() => getComputedStyle(document.querySelector('.ide-status')).backgroundColor);

    // Closing the window must hide it into the tray instead of ending the app,
    // so a running job keeps going; only the tray quit may exit.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());
    await page.waitForTimeout(1_500);
    checks.closeToTray = await app.evaluate(({ BrowserWindow }) => {
      const windows = BrowserWindow.getAllWindows();
      return {
        windowCount: windows.length,
        visible: windows[0]?.isVisible() ?? null,
        destroyed: windows[0]?.isDestroyed() ?? null,
      };
    });
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      if (window) { window.show(); window.focus(); }
    });
    await page.waitForTimeout(400);

    const errors = await page.evaluate(() => window.__sandkastenErrors ?? []);
    checks.rendererErrors = errors;
    // A report alone is not a release gate: enforce each externally visible
    // contract so a broken layout or tray behavior makes the command fail.
    assert.equal(checks.bridgeExposed, true);
    assert.equal(checks.localRunOutput, 'E2E-LOCAL-RUN-OK');
    assert.equal(checks.createdOnDisk, true);
    assert.equal(checks.panelHidden, true);
    assert.equal(checks.sidebarHiddenByButton, true);
    assert.equal(checks.collapseButton?.insideHeader, true);
    assert.equal(checks.collapseButton?.lastControl, true);
    assert.ok(checks.collapseButton?.rightGap <= 12);
    assert.ok(checks.treeScrollable && checks.treeScrollTop > 0, 'workspace tree must scroll');
    assert.ok(checks.editorScrollable && checks.editorScrollTop > 0, 'editor must scroll');
    assert.ok(checks.panelScrollable && checks.panelScrollTop > 0, 'output panel must scroll');
    assert.equal(checks.documentScrollY, 0);
    assert.equal(checks.minimap?.present, true);
    assert.equal(checks.minimap?.painted, true);
    assert.equal(checks.minimumWindow?.statusVisible, true);
    assert.equal(checks.minimumWindow?.documentBounded, true);
    assert.equal(checks.colorScheme, 'pink');
    assert.equal(checks.storedColorScheme, null);
    assert.equal(checks.titleRow?.headerIntegrated, true);
    assert.equal(checks.titleRow?.headerHeight, 40);
    assert.equal(checks.titleRow?.dragRegion, 'drag');
    assert.equal(checks.titleRow?.menus.length, 5);
    assert.equal(checks.titleRowMenu?.expanded, true);
    assert.equal(checks.titleRowMenu?.dismissed, true);
    assert.deepEqual(checks.closeToTray, { windowCount: 1, visible: false, destroyed: false });
    assert.equal(checks.layout?.noPageScroll, true);
    assert.equal(checks.layout?.fullHeight, true);
    assert.deepEqual(checks.rendererErrors, []);
    assert.ok(!checks.consoleMessages.some((message) => message.startsWith('pageerror:')), 'renderer must not raise uncaught errors');
  } catch (error) {
    failure = error;
  } finally {
    await app.close().catch(() => {});
    await rm(testRoot, { recursive: true, force: true }).catch(() => {});
  }

  process.stdout.write(`${JSON.stringify(checks, null, 2)}\n`);
  if (failure) throw failure;
}

main().catch((error) => {
  process.stderr.write(`desktop ide e2e: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
