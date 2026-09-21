import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// The brand icon lives in the app's build resources and is shared by the window,
// the packaged executable, and the installer so every surface shows the same mark.
const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const APP_ICON_PATH = path.join(appRoot, 'build', 'icon.png');

export function isBundledUrl(target, bundledIndex) {
  if (typeof target !== 'string' || target === '') return false;
  let parsed;
  try {
    parsed = new URL(target);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'file:') return false;
  const root = path.dirname(path.resolve(bundledIndex));
  const candidate = path.resolve(decodeURIComponent(parsed.pathname.replace(/^\/(?=[A-Za-z]:)/, '')));
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function shouldOpenExternally(target) {
  if (typeof target !== 'string') return false;
  let parsed;
  try {
    parsed = new URL(target);
  } catch {
    return false;
  }
  return parsed.protocol === 'https:' || parsed.protocol === 'http:';
}

export const WINDOW_CHROME_THEMES = {
  // The window chrome follows the pure workbench surfaces: pure white in
  // light, pure black in dark, so the native title bar never sits on a tint.
  light: { color: '#ffffff', symbolColor: '#1a1c1f', height: 40 },
  dark: { color: '#000000', symbolColor: '#f1f1f1', height: 40 },
};

export function createWindowOptions({ preloadPath, bundledIndex, title = 'Sandkasten', icon = APP_ICON_PATH, platform = process.platform } = {}) {
  return {
    show: false,
    title,
    icon,
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: WINDOW_CHROME_THEMES.light.color,
    titleBarStyle: 'hidden',
    autoHideMenuBar: true,
    ...(platform === 'darwin'
      ? { trafficLightPosition: { x: 12, y: 13 } }
      : { titleBarOverlay: { ...WINDOW_CHROME_THEMES.light } }),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      preload: preloadPath,
      additionalArguments: bundledIndex ? [`--sandkasten-index=${pathToFileURL(bundledIndex).href}`] : [],
    },
  };
}

export function applyWindowChromePolicy({ window, platform = process.platform }) {
  if (platform === 'darwin') return;
  window.setMenuBarVisibility(false);
  window.webContents.on('before-input-event', (event, input) => {
    // autoHideMenuBar otherwise restores a second row on bare Alt. Suppress only
    // that toggle; command shortcuts and AltGr/IME combinations keep working.
    if (input.key === 'Alt' && !input.control && !input.meta && !input.shift) event.preventDefault();
  });
}

export function applyNavigationPolicy({ webContents, bundledIndex, openExternal }) {
  webContents.setWindowOpenHandler(({ url }) => {
    if (shouldOpenExternally(url)) openExternal(url);
    return { action: 'deny' };
  });

  webContents.on('will-navigate', (event, url) => {
    if (isBundledUrl(url, bundledIndex)) return;
    event.preventDefault();
    if (shouldOpenExternally(url)) openExternal(url);
  });

  if (typeof webContents.on === 'function') {
    webContents.on('will-attach-webview', (event) => event.preventDefault());
  }
}
