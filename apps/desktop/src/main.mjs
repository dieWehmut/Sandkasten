import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveVerifiedDistribution } from './distribution.mjs';
import { prepareDistribution, resolveApiBaseUrl } from './config-override.mjs';
import { applyNavigationPolicy, createWindowOptions, APP_ICON_PATH } from './navigation.mjs';
import { registerDesktopIpc, resolveInitialWorkspace, IPC_CHANNELS } from './ipc.mjs';
import { createLocalRunner } from './local-runner.mjs';
import { createIsolatedRunner } from './isolated-runner.mjs';
import { buildMenuTemplate } from './menu.mjs';
import { createWorkspaceSession } from './workspace.mjs';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function createWindow(bundledIndex) {
  const window = new BrowserWindow(
    createWindowOptions({
      bundledIndex,
      preloadPath: path.join(appRoot, 'src', 'preload.cjs'),
      icon: app.isPackaged ? path.join(process.resourcesPath, 'icon.png') : APP_ICON_PATH,
    }),
  );

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
  Menu.setApplicationMenu(Menu.buildFromTemplate(buildMenuTemplate({ send: sendToWindow })));

  app.on('before-quit', () => {
    void runner.stopAll();
    void isolated.stopAll();
  });

  return createWindow(path.join(activeDistribution, 'index.html'));
}

app.whenReady().then(start).catch((error) => {
  dialog.showErrorBox('Sandkasten cannot start', error instanceof Error ? error.message : String(error));
  app.exit(1);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void start().catch((error) => {
      dialog.showErrorBox('Sandkasten cannot start', error instanceof Error ? error.message : String(error));
      app.exit(1);
    });
  }
});
