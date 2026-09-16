// Electron main process used only by scripts/smoke.mjs. It loads the built
// WebUI from SANDKASTEN_SMOKE_INDEX and reports whether the Vue shell mounted.
import { app, BrowserWindow } from 'electron';

const index = process.env.SANDKASTEN_SMOKE_INDEX;

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  await window.loadFile(index);
  const shell = await window.webContents.executeJavaScript(
    'Boolean(document.querySelector(\'[data-testid="app-shell"]\'))',
  );
  const title = await window.webContents.executeJavaScript('document.title');
  process.stdout.write(JSON.stringify({ shell, title }) + '\n');
  app.exit(shell ? 0 : 2);
}).catch((error) => {
  process.stderr.write((error instanceof Error ? error.message : String(error)) + '\n');
  app.exit(1);
});
