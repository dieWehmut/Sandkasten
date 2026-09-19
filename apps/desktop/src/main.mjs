import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, shell, Tray } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveVerifiedDistribution } from './distribution.mjs';
import { prepareDistribution, resolveApiBaseUrl } from './config-override.mjs';
import { applyNavigationPolicy, applyWindowChromePolicy, createWindowOptions, APP_ICON_PATH } from './navigation.mjs';
import { registerDesktopIpc, registerWindowChromeIpc, resolveInitialWorkspace, IPC_CHANNELS } from './ipc.mjs';
import { createLocalRunner } from './local-runner.mjs';
import { createIsolatedRunner } from './isolated-runner.mjs';
import { buildMenuTemplate } from './menu.mjs';
import { createWorkspaceSession } from './workspace.mjs';
import { createTerminalHost } from './terminal.mjs';
import { spawnPty, shutdownPtyWorkers } from './terminal-pty.mjs';
import { discoverTerminalProfiles } from './terminal-profiles.mjs';
import { registerTerminalIpc } from './terminal-ipc.mjs';
import { applyCloseToTrayPolicy, createAppTray, trayIconPath } from './tray.mjs';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Closing the window hides it into the tray so a running job keeps going; only
// the tray quit (or the OS asking the app to exit) tears the app down.
let quitting = false;

function createWindow(bundledIndex) {
  const window = new BrowserWindow(
    createWindowOptions({
      bundledIndex,
      preloadPath: path.join(appRoot, 'src', 'preload.cjs'),
      icon: app.isPackaged ? path.join(process.resourcesPath, 'icon.png') : APP_ICON_PATH,
    }),
  );
  applyWindowChromePolicy({ window });
  applyCloseToTrayPolicy({ window, isQuitting: () => quitting });

  applyNavigationPolicy({
    webContents: window.webContents,
    bundledIndex,
    openExternal: (url) => {
      void shell.openExternal(url);
    },
  });

  window.once('ready-to-show', () => window.show());
  void window.loadFile(bundledIndex);
  return window;
}

async function start() {
  const distribution = await resolveVerifiedDistribution({
    appRoot,
    resourcesPath: app.isPackaged ? process.resourcesPath : undefined,
  });
  const apiBaseUrl = resolveApiBaseUrl();
  const activeDistribution = await prepareDistribution(distribution, {
    apiBaseUrl,
    stageRoot: app.getPath('userData'),
  });

  const session = createWorkspaceSession({
    storeFile: path.join(app.getPath('userData'), 'workspace.json'),
  });
  const runner = createLocalRunner();
  const isolated = createIsolatedRunner();
  await resolveInitialWorkspace(session).catch(() => null);

  const focusedWindow = () => BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  const sendToWindow = (command) => {
    const target = focusedWindow();
    if (target && !target.isDestroyed()) target.webContents.send(IPC_CHANNELS.menu, command);
  };

  registerDesktopIpc({ ipcMain, dialog, runner, isolated, session, getWindow: focusedWindow });
  const bundledIndex = path.join(activeDistribution, 'index.html');
  const terminal = createTerminalHost({
    spawn: spawnPty,
    profiles: await discoverTerminalProfiles(),
    getCwd: () => session.root,
    onData: (owner, event) => { if (!owner.isDestroyed()) owner.send(IPC_CHANNELS.terminalData, event); },
    onExit: (owner, event) => { if (!owner.isDestroyed()) owner.send(IPC_CHANNELS.terminalExit, event); },
  });
  registerTerminalIpc({
    ipcMain, terminal, bundledIndex,
    getWindowForContents: (contents) => BrowserWindow.fromWebContents(contents),
  });
  registerWindowChromeIpc({
    ipcMain,
    Menu,
    getWindowForContents: (webContents) => BrowserWindow.fromWebContents(webContents),
    bundledIndex,
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate(buildMenuTemplate({ send: sendToWindow })));

  let quitPrepared = false;
  app.on('before-quit', (event) => {
    quitting = true;
    if (quitPrepared) return;
    event.preventDefault();
    terminal.dispose();
    void runner.stopAll();
    void isolated.stopAll();
    void shutdownPtyWorkers().finally(() => {
      quitPrepared = true;
      app.quit();
    });
  });

  // The tray keeps the app alive after the window is closed so a running job is
  // never cancelled by a stray click on the window close button. Its left click
  // restores the window; its right click offers the settings that matter while
  // the window is hidden.
  const tray = createAppTray({
    Tray,
    Menu,
    nativeImage,
    iconPath: trayIconPath({
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      appRoot,
    }),
    locale: trayLocale(),
    getAllWindows: () => BrowserWindow.getAllWindows(),
    createWindow: () => createWindow(bundledIndex),
    sendCommand: sendToWindow,
    quit: () => app.quit(),
  });

  return { window: createWindow(bundledIndex), tray };
}

function trayLocale() {
  const requested = (process.env.SANDKASTEN_LOCALE ?? app.getLocale?.() ?? '').toLowerCase();
  return requested.startsWith('zh') ? 'zh-CN' : 'en';
}

let applicationTray;

app.whenReady().then(() => start().then(({ tray }) => {
  applicationTray = tray;
})).catch((error) => {
  dialog.showErrorBox('Sandkasten cannot start', error instanceof Error ? error.message : String(error));
  app.exit(1);
});

app.on('will-quit', () => {
  applicationTray?.destroy?.();
  applicationTray = undefined;
});

// Closing the last window only hides it: the tray owns the exit. macOS keeps
// its usual behavior because the dock already means "app is still running".
app.on('window-all-closed', () => {
  if (quitting) app.quit();
});

app.on('activate', () => {
  const windows = BrowserWindow.getAllWindows();
  if (windows.length === 0) return;
  const window = windows[0];
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
});
