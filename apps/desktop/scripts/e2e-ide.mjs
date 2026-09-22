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

import { selectTheme } from './e2e-theme.mjs';
import { verifyTrayUpdate } from './e2e-tray-update.mjs';

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
  // The source control view needs a repository, and the remote explorer needs
  // an SSH config; both are real files so the run exercises the real parsers.
  const sshDirectory = path.join(testRoot, 'ssh');
  await mkdir(sshDirectory);
  const sshConfig = path.join(sshDirectory, 'config');
  await writeFile(sshConfig, [
    '# The end-to-end run must never touch the real ~/.ssh/config.',
    'Host sandkasten-e2e',
    '  HostName 192.168.50.11',
    '  User root',
    '  Port 2222',
    '',
  ].join('\n'));
  const gitRun = (...args) => spawnSync('git', ['-c', 'user.email=e2e@sandkasten.local', '-c', 'user.name=E2E Run', ...args], { cwd: workspace, stdio: 'ignore' });
  gitRun('init', '--initial-branch=main');
  gitRun('add', '.');
  gitRun('commit', '-m', 'e2e: first commit');
  await writeFile(path.join(workspace, 'notes.md'), '# notes\nchanged by the fixture\n');
  await mkdir(path.join(outputRoot), { recursive: true });

  const packagedExecutable = process.env.SANDKASTEN_E2E_EXECUTABLE;
  const profileArgument = `--user-data-dir=${path.join(testRoot, 'profile')}`;
  // The tray update flow is driven through the app's own probe: the scripted
  // release keeps the check off the network and lets the run assert what the
  // dialog would have shown.
  const e2eEnv = {
    ...process.env,
    SANDKASTEN_WORKSPACE_ROOT: workspace,
    SANDKASTEN_E2E_PROBE: '1',
    SANDKASTEN_E2E_RELEASE: process.env.SANDKASTEN_E2E_RELEASE ?? 'v9.9.9',
    SANDKASTEN_SSH_CONFIG: sshConfig,
  };
  const app = packagedExecutable
    ? await driver.launch({ executablePath: packagedExecutable, args: [profileArgument], env: e2eEnv })
    : await driver.launch({ executablePath: electronExecutable, args: ['.', profileArgument], cwd: appRoot, env: e2eEnv });

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
      // The Run menu was removed from the native bar, so the check anchors on
      // the View menu, which must still open and dismiss in place.
      const viewButton = page.locator('[data-menu="view"]');
      const viewBox = await viewButton.boundingBox();
      await viewButton.click();
      await page.waitForFunction(() => document.querySelector('[data-menu="view"]')?.getAttribute('aria-expanded') === 'true', null, { timeout: 10_000 });
      checks.titleRowMenu = { anchorX: Math.round(viewBox?.x ?? 0), expanded: true };
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => document.querySelector('[data-menu="view"]')?.getAttribute('aria-expanded') === 'false', null, { timeout: 10_000 });
      checks.titleRowMenu.dismissed = true;
      checks.titleRowRunMenuRemoved = (await page.locator('[data-menu="run"]').count()) === 0;
    }

    // The reduced title row moved the theme control into the settings screen,
    // so each theme is chosen through the real appearance previews.
    const ensureTheme = (theme) => selectTheme(page, theme);

    // The reduced title row removed the header's setup, locale, history,
    // inspector, and theme controls. Each one must still be reachable: the
    // centered search control opens the palette, and the activity bar's footer
    // opens the settings screen that now owns the displaced controls.
    {
      checks.titleRowRemovedControls = await page.evaluate(() => {
        const header = document.querySelector('[data-testid="app-header"]');
        const missing = ['toggle-theme', 'toggle-history', 'toggle-inspector', 'open-setup-guide', 'open-api-endpoint', 'open-github'];
        return {
          controls: missing.filter((action) => header?.querySelector(`[data-action="${action}"]`)),
          localeSwitcher: header?.querySelector('[data-testid="locale-switcher"]') !== null,
          connectionStatus: header?.querySelector('.connection-status') !== null,
          wordmark: header?.querySelector('.brand strong') !== null,
          history: header?.querySelector('.editor-navigation') !== null,
          search: header?.querySelector('[data-action="quick-open"]') !== null,
        };
      });

      const search = page.locator('[data-action="quick-open"]');
      await search.click();
      await page.waitForSelector('[data-testid="command-palette"]');
      checks.palette = await page.evaluate(() => {
        const palette = document.querySelector('[data-testid="command-palette"]');
        const box = palette?.getBoundingClientRect();
        return {
          centered: box ? Math.abs((box.left + box.width / 2) - window.innerWidth / 2) <= 2 : false,
          files: Array.from(palette?.querySelectorAll('[data-kind="file"]') ?? []).map((item) => item.querySelector('.command-palette__label')?.textContent?.trim() ?? ''),
          recents: Array.from(palette?.querySelectorAll('[data-kind="file"] [data-recent]') ?? []).length,
          recentNames: Array.from(palette?.querySelectorAll('[data-kind="file"]') ?? []).filter((item) => item.querySelector('.command-palette__recent')).map((item) => item.querySelector('.command-palette__label')?.textContent?.trim() ?? ''),
          mode: palette?.querySelector('[data-kind="mode"]')?.querySelector('.command-palette__label')?.textContent?.trim() ?? null,
          modeAccelerator: palette?.querySelector('[data-kind="mode"] kbd')?.textContent?.trim() ?? null,
          modeExpected: document.documentElement.lang === 'zh-CN' ? '显示并运行命令' : 'Show and Run Commands',
        };
      });
      await page.keyboard.press('Escape');
      await page.waitForSelector('[data-testid="command-palette"]', { state: 'detached', timeout: 5_000 });

      // The palette lists the real commands with their accelerators, and never
      // offers one the app cannot perform.
      await page.keyboard.press('Control+Shift+P');
      await page.waitForSelector('[data-testid="command-palette"]');
      checks.paletteCommands = await page.evaluate(() => {
        const items = Array.from(document.querySelectorAll('[data-testid="command-palette"] [data-command]'));
        return items.map((item) => ({
          command: item.getAttribute('data-command'),
          label: item.querySelector('.command-palette__label')?.textContent?.trim() ?? null,
          accelerator: item.querySelector('kbd')?.textContent?.trim() ?? null,
        }));
      });
      await page.keyboard.press('Escape');
      await page.waitForSelector('[data-testid="command-palette"]', { state: 'detached', timeout: 5_000 });

      // The settings screen is the surviving home of the removed controls.
      await page.click('[data-action="open-settings"]');
      await page.waitForSelector('[data-testid="settings-view"]');
      checks.settings = await page.evaluate(() => {
        const sections = Array.from(document.querySelectorAll('[data-section]')).map((button) => button.getAttribute('data-section'));
        return {
          sections,
          search: document.querySelector('.settings-search input') !== null,
          themes: Array.from(document.querySelectorAll('[data-theme-choice]')).map((button) => button.getAttribute('data-theme-choice')),
          colors: Array.from(document.querySelectorAll('[data-color]')).map((input) => input.getAttribute('data-color')),
        };
      });
      await page.click('[data-section="general"]');
      await page.click('[data-testid="settings-open-setup"]');
      await page.waitForSelector('[data-testid="setup-welcome"]');
      checks.settingsSetupGuide = true;
      await page.click('[data-testid="setup-dismiss"]');
      await page.waitForSelector('[data-testid="workbench-shell"]');
    }

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

    // The sidebar is the resource manager: Explorer, Search, Source Control,
    // and the Remote Explorer each render real data from the main process.
    {
      const views = {};
      // Explorer carries the reference's four header buttons.
      views.explorerHeader = await page.evaluate(() => {
        const header = document.querySelector('.ide-sidebar__header');
        return Array.from(header?.querySelectorAll('button[data-action]') ?? [])
          .map((button) => button.getAttribute('data-action'));
      });

      // Search: a real query over the opened folder lists files with matches.
      await page.click('[data-activity="search"]');
      await page.waitForSelector('[data-testid="workspace-search-input"]');
      await page.fill('[data-testid="workspace-search-input"]', 'util-ok');
      await page.press('[data-testid="workspace-search-input"]', 'Enter');
      await page.waitForSelector('[data-match-path="pkg/util.py"]', { timeout: 15_000 });
      views.search = await page.evaluate(() => ({
        summary: document.querySelector('[data-testid="workspace-search-summary"]')?.textContent?.trim() ?? null,
        files: Array.from(document.querySelectorAll('[data-match-path]')).map((node) => node.getAttribute('data-match-path')),
      }));
      await page.click('[data-match-path="pkg/util.py"] [data-line]');
      // The tab id carries the workspace-relative path, not just the name.
      await page.waitForSelector('[data-action="ide-tab-pkg/util.py"]', { timeout: 10_000 });
      views.searchOpened = (await page.locator('.ide-tab--active .ide-tab__name').innerText()).trim();

      // Source control: the E2E workspace is a real repository with one staged
      // change, so the view must report the branch, the file, and the history.
      await page.click('[data-activity="source-control"]');
      await page.waitForSelector('[data-testid="source-control"]');
      await page.waitForSelector('[data-testid="source-control-branch"]', { timeout: 15_000 });
      views.sourceControl = await page.evaluate(() => ({
        branch: document.querySelector('[data-testid="source-control-branch"]')?.textContent?.trim() ?? null,
        changes: Array.from(document.querySelectorAll('[data-change]')).map((node) => node.getAttribute('data-change')),
        staged: Array.from(document.querySelectorAll('[data-group="staged"] [data-change]')).map((node) => node.getAttribute('data-change')),
        history: Array.from(document.querySelectorAll('[data-commit]')).map((node) => node.getAttribute('data-commit')),
        // The reference draws a rail beside every commit, so the graph must
        // be one dot per row, with the HEAD row marked and badged.
        graphDots: document.querySelectorAll('[data-testid="source-control-graph"]').length,
        headRows: Array.from(document.querySelectorAll('[data-head="true"]')).map((node) => node.getAttribute('data-commit')),
        refBadges: Array.from(document.querySelectorAll('[data-ref]')).map((node) => node.getAttribute('data-ref')),
        commitRefs: Array.from(document.querySelectorAll('[data-commit]')).map((node) => ({
          commit: node.getAttribute('data-commit'),
          column: Number(node.getAttribute('data-column')),
          head: node.getAttribute('data-head'),
        })),
        canCommit: !document.querySelector('[data-action="source-control-commit"]')?.hasAttribute('disabled'),
      }));
      // The fixture leaves the change unstaged, so the commit action must be
      // honestly disabled until the file is staged through the view.
      await page.fill('[data-testid="source-control-message"]', 'e2e: commit the fixture change');
      views.sourceControlCommitBlocked = await page.locator('[data-action="source-control-commit"]').isDisabled();
      await page.click('[data-stage="notes.md"]');
      await page.waitForFunction(() => !document.querySelector('[data-action="source-control-commit"]')?.hasAttribute('disabled'), null, { timeout: 15_000 });
      views.sourceControlCommitEnabled = !(await page.locator('[data-action="source-control-commit"]').isDisabled());
      views.sourceControlStaged = await page.evaluate(() => Array.from(document.querySelectorAll('[data-group="staged"] [data-change]')).map((node) => node.getAttribute('data-change')));
      await page.click('[data-action="source-control-commit"]');
      await page.waitForFunction(() => document.querySelector('[data-testid="source-control"] [data-commit]')?.getAttribute('data-commit') !== null
        && document.querySelector('[data-testid="source-control-count"]')?.textContent?.includes('0'), null, { timeout: 20_000 });
      views.sourceControlCommitted = await page.evaluate(() => ({
        history: Array.from(document.querySelectorAll('[data-commit]')).map((node) => node.textContent?.trim() ?? ''),
        clean: document.querySelector('[data-testid="source-control-clean"]') !== null,
      }));

      // Remote explorer: the SSH config is provided through the environment, so
      // the view must list the host and hand it to the terminal on selection.
      await page.click('[data-activity="remote"]');
      await page.waitForSelector('[data-testid="remote-explorer"]');
      await page.waitForSelector('[data-host="sandkasten-e2e"]', { timeout: 15_000 });
      views.remote = await page.evaluate(() => ({
        hosts: Array.from(document.querySelectorAll('[data-host]')).map((node) => node.getAttribute('data-host')),
        directories: Array.from(document.querySelectorAll('[data-directory]')).map((node) => node.getAttribute('data-directory')),
      }));
      // The bridge composes the ssh line; the panel then types it into a real
      // session, so the observed contract is the panel opening plus the write
      // the main process receives.
      views.remoteSession = await page.evaluate(async () => {
        const hosts = await window.sandkastenDesktop.remote.list();
        return window.sandkastenDesktop.remote.open({ host: 'sandkasten-e2e', profileId: 'pwsh' })
          .then((session) => ({ configured: hosts.hosts.map((host) => host.alias), command: session.command }));
      });
      await page.click('[data-open="sandkasten-e2e"]');
      await page.waitForSelector('[data-testid="terminal-panel"]', { timeout: 15_000 });
      views.remoteHandoff = await page.evaluate(() => ({
        panel: document.querySelector('[data-testid="terminal-panel"]') !== null,
        sessions: document.querySelectorAll('.terminal-pane').length,
      }));

      // The surfaces are pure: the canvas, chrome, and sidebar carry no tint.
      views.pureSurfaces = await page.evaluate(() => {
        const read = (selector) => document.querySelector(selector)?.style?.backgroundColor ?? '';
        return {
          body: getComputedStyle(document.body).backgroundColor,
          activity: getComputedStyle(document.querySelector('.ide-activity')).backgroundColor,
          sidebar: getComputedStyle(document.querySelector('.ide-sidebar')).backgroundColor,
        };
      });
      checks.sidebarViews = views;
      // The rest of the run drives the explorer tree, so the sidebar returns to
      // it; the terminal panel the hand-off opened stays closed the same way.
      await page.click('[data-activity="explorer"]');
      await page.waitForSelector('[data-path="hello.py"]', { timeout: 15_000 });
      await page.click('[data-action="ide-tab-close-pkg/util.py"]').catch(() => undefined);
    }

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

    // The creation row belongs to the selection: with a file inside pkg open,
    // the row must land under pkg and carry pkg as its parent, the way VS Code
    // places it, instead of appearing at the top of the panel. The tree lists
    // every directory open by default, so no toggle is needed to reach the file.
    await page.waitForSelector('[data-path="pkg/util.py"]');
    await page.click('[data-path="pkg/util.py"] .ide-tree__open');
    await page.keyboard.press('Control+n');
    await page.waitForSelector('[data-testid="ide-new-file-form"]');
    checks.createRowParent = await page.locator('[data-testid="ide-inline-create"]').getAttribute('data-parent');
    checks.createRowInsideTree = await page.evaluate(() => {
      const row = document.querySelector('[data-testid="ide-inline-create"]');
      const tree = document.querySelector('.ide-tree');
      return Boolean(row && tree && tree.contains(row));
    });
    const createShot = path.join(outputRoot, 'desktop-ide-inline-create.png');
    await page.screenshot({ path: createShot });
    checks.createRowScreenshot = createShot;
    await page.fill('input[name="fileName"]', 'extra.py');
    await page.click('[data-action="ide-create-file"]');
    // The row is scoped to the selection, so the new file appears under pkg and
    // never at the workspace root.
    await page.waitForSelector('[data-path="pkg/extra.py"]');
    checks.createdInSelectedFolder = existsSync(path.join(workspace, 'pkg', 'extra.py'));
    checks.createdOnDisk = existsSync(path.join(workspace, 'extra.py'));

    // The folder row follows the same rule, so the reference's second row lands
    // beside the file's directory instead of at the panel top.
    await page.click('[data-action="ide-new-folder"]');
    await page.waitForSelector('[data-testid="ide-new-folder-form"]');
    checks.folderRowParent = await page.locator('[data-testid="ide-inline-create"]').getAttribute('data-parent');
    checks.folderRowKind = await page.locator('[data-testid="ide-inline-create"]').getAttribute('data-kind');
    await page.fill('input[name="folderName"]', 'generated');
    await page.click('[data-action="ide-create-folder"]');
    await page.waitForSelector('[data-path="pkg/generated"]');
    checks.createdFolderInSelectedFolder = existsSync(path.join(workspace, 'pkg', 'generated'));
    checks.createdFolderOnDisk = existsSync(path.join(workspace, 'generated'));
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
    // The tray owns the release check, so the run drives the real menu item
    // after the window has hidden: the hidden window must not block it.
    checks.trayUpdate = await verifyTrayUpdate({
      app,
      scriptedTag: e2eEnv.SANDKASTEN_E2E_RELEASE,
      locale: checks.titleRow?.menus?.includes('文件') ? 'zh' : 'en',
      currentVersion: await app.evaluate(({ app: electronApp }) => electronApp.getVersion()),
      report: checks,
    });
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
    assert.equal(checks.savedRemotely, true);
    // The row is inline and scoped to the selection, so the file lands in pkg
    // rather than at the workspace root.
    assert.equal(checks.createRowParent, 'pkg', 'the creation row must belong to the selected file directory');
    assert.equal(checks.createRowInsideTree, true, 'the creation row must render inside the tree');
    assert.equal(checks.createdInSelectedFolder, true, 'the new file must land in the selected directory');
    assert.equal(checks.createdOnDisk, false);
    assert.equal(checks.folderRowParent, 'pkg', 'the folder row must belong to the selected file directory');
    assert.equal(checks.folderRowKind, 'folder');
    assert.equal(checks.createdFolderInSelectedFolder, true, 'the new folder must land in the selected directory');
    assert.equal(checks.createdFolderOnDisk, false);
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
    // The sidebar resource manager: each view renders real data, the commit
    // round-trips, the remote entry reaches the terminal, and the surfaces are
    // pure black or pure white.
    assert.deepEqual(checks.sidebarViews?.explorerHeader, [
      'ide-new-file', 'ide-new-folder', 'ide-refresh-tree', 'ide-collapse-folders', 'ide-collapse-sidebar',
    ]);
    assert.ok(checks.sidebarViews?.search?.files.includes('pkg/util.py'), 'search must list the matching file');
    // The summary is localized, so the counts are asserted rather than the prose.
    assert.match(checks.sidebarViews?.search?.summary ?? '', /1\s*(?:result|个结果)/i);
    assert.match(checks.sidebarViews?.search?.summary ?? '', /1\s*(?:file|个文件)/i);
    assert.equal(checks.sidebarViews?.searchOpened, 'util.py');
    assert.equal(checks.sidebarViews?.sourceControl?.branch, 'main');
    assert.ok(checks.sidebarViews?.sourceControl?.changes.includes('notes.md'), 'the changed file must be listed');
    assert.equal(checks.sidebarViews?.sourceControlCommitBlocked, true, 'the commit action must wait for staged work');
    // The history renders as the reference's graph: every commit gets a rail,
    // exactly one row is the HEAD ring, and the checked-out branch is badged.
    const graph = checks.sidebarViews?.sourceControl;
    assert.equal(graph?.graphDots, graph?.history.length, 'every commit row must carry a graph rail');
    assert.deepEqual(graph?.headRows, [graph?.history[0]], 'only the checked-out commit is the HEAD row');
    assert.ok((graph?.refBadges ?? []).includes('main'), 'the checked-out branch must be badged: ' + JSON.stringify(graph?.refBadges));
    assert.ok((graph?.commitRefs ?? []).every((row) => Number.isInteger(row.column) && row.column >= 0), 'every row must sit on a lane');
    assert.equal(checks.sidebarViews?.sourceControlCommitEnabled, true);
    assert.deepEqual(checks.sidebarViews?.sourceControlStaged, ['notes.md']);
    assert.ok(checks.sidebarViews?.sourceControlCommitted?.history.some((entry) => entry.includes('e2e: commit the fixture change')), 'the commit must reach the history');
    assert.equal(checks.sidebarViews?.sourceControlCommitted?.clean, true);
    assert.deepEqual(checks.sidebarViews?.remote?.hosts, ['sandkasten-e2e']);
    assert.equal(checks.sidebarViews?.remoteHandoff?.panel, true, 'choosing a host must open the terminal panel');
    assert.deepEqual(checks.sidebarViews?.remoteSession?.configured, ['sandkasten-e2e']);
    assert.match(checks.sidebarViews?.remoteSession?.command ?? '', /^ssh(?: -p 2222)? root@192\.168\.50\.11$/);
    assert.ok(checks.sidebarViews?.remoteHandoff?.sessions > 0, 'the hand-off must open a real terminal session');
    assert.deepEqual(checks.sidebarViews?.pureSurfaces, {
      body: 'rgb(255, 255, 255)',
      activity: 'rgb(255, 255, 255)',
      sidebar: 'rgb(255, 255, 255)',
    });
    assert.equal(checks.colorScheme, 'pink');
    assert.equal(checks.storedColorScheme, null);
    assert.equal(checks.titleRow?.headerIntegrated, true);
    assert.equal(checks.titleRow?.headerHeight, 40);
    assert.equal(checks.titleRow?.dragRegion, 'drag');
    assert.equal(checks.titleRow?.menus.length, 4);
    assert.equal(checks.titleRowMenu?.expanded, true);
    assert.equal(checks.titleRowMenu?.dismissed, true);
    assert.equal(checks.titleRowRunMenuRemoved, true);
    // The reduced title row keeps the brand mark, the history pair, and the
    // centered search; the displaced controls live in settings and the palette.
    assert.deepEqual(checks.titleRowRemovedControls, {
      controls: [],
      localeSwitcher: false,
      connectionStatus: false,
      wordmark: false,
      history: true,
      search: true,
    });
    assert.equal(checks.palette?.centered, true);
    assert.ok(checks.palette?.files.includes('hello.py'), 'the palette must search the opened workspace');
    assert.ok(checks.palette?.files.includes('util.py'), 'the palette must search nested workspace files');
    assert.deepEqual(checks.palette?.recentNames, ['hello.py'], 'the recently opened file must lead the list');
    assert.equal(checks.palette?.mode, checks.palette?.modeExpected, 'the palette must offer the command mode before a query');
    assert.equal(checks.palette?.modeAccelerator, 'Ctrl+Shift+P');
    assert.ok(checks.paletteCommands?.length, 'the palette must list the real commands');
    const listed = new Map(checks.paletteCommands.map((entry) => [entry.command, entry.accelerator]));
    assert.equal(listed.has('run.start'), false, 'a command the app cannot perform must not be listed');
    assert.equal(listed.has('run.stop'), false, 'a command the app cannot perform must not be listed');
    for (const [id, accelerator] of [['file.new', 'Ctrl+N'], ['file.save', 'Ctrl+S'], ['view.toggleSidebar', 'Ctrl+B'], ['view.togglePanel', 'Ctrl+J'], ['terminal.toggle', 'Ctrl+`']]) {
      assert.equal(listed.get(id), accelerator, id + ' must keep its accelerator');
    }
    assert.equal(listed.has('theme.toggle'), true, 'the removed header theme control stays reachable from the palette');
    assert.deepEqual(checks.settings?.themes, ['system', 'light', 'dark']);
    assert.deepEqual(checks.settings?.colors, ['accent', 'background', 'foreground']);
    assert.equal(checks.settings?.search, true);
    for (const section of ['general', 'appearance', 'connection', 'workbench']) {
      assert.ok(checks.settings?.sections.includes(section), 'settings must keep the ' + section + ' section');
    }
    assert.equal(checks.settingsSetupGuide, true);
    assert.deepEqual(checks.closeToTray, { windowCount: 1, visible: false, destroyed: false });
    assert.equal(checks.trayUpdate?.initial.enabled, true);
    assert.equal(checks.trayUpdate?.busy.enabled, false, 'the tray reports progress while the check runs');
    assert.equal(checks.trayUpdate?.settled.menu.enabled, true, 'the tray accepts another check once it settles');
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
