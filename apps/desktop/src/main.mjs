import { app, BrowserWindow, dialog, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveVerifiedDistribution } from './distribution.mjs';
import { prepareDistribution, resolveApiBaseUrl } from './config-override.mjs';
import { applyNavigationPolicy, createWindowOptions } from './navigation.mjs';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function createWindow(bundledIndex) {
  const window = new BrowserWindow(
    createWindowOptions({
      bundledIndex,
      preloadPath: path.join(appRoot, 'src', 'preload.mjs'),
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
  createWindow(path.join(activeDistribution, 'index.html'));
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
