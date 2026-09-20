// Taskbar tray integration. Closing the window must not end a running task, so
// the app keeps living in the tray and only the explicit tray quit exits.
import path from 'node:path';

const LABELS = {
  en: {
    tooltip: 'Sandkasten',
    open: 'Open Sandkasten',
    settings: 'Settings',
    checkForUpdates: 'Check for updates…',
    checkingForUpdates: 'Checking for updates…',
    quit: 'Quit Sandkasten',
  },
  'zh-CN': {
    tooltip: 'Sandkasten',
    open: '打开 Sandkasten',
    settings: '设置',
    checkForUpdates: '检查更新…',
    checkingForUpdates: '正在检查更新…',
    quit: '退出 Sandkasten',
  },
};

export const TRAY_COMMANDS = {
  settings: 'settings.open',
};

function labelsFor(locale) {
  return LABELS[locale] ?? LABELS.en;
}

export function trayIconPath({ isPackaged = false, resourcesPath, appRoot } = {}) {
  if (isPackaged && typeof resourcesPath === 'string' && resourcesPath !== '') {
    return path.join(resourcesPath, 'icon.png');
  }
  if (typeof appRoot !== 'string' || appRoot === '') throw new Error('an app root is required to resolve the tray icon');
  return path.join(appRoot, 'build', 'icon.png');
}

export function showMainWindow({ getAllWindows, createWindow } = {}) {
  const window = getAllWindows?.()[0];
  if (window && !window.isDestroyed()) {
    if (window.isMinimized?.()) window.restore();
    window.show();
    window.focus();
    return true;
  }
  if (typeof createWindow === 'function') {
    createWindow();
    return true;
  }
  return false;
}

export function trayMenuTemplate({
  locale = 'en',
  showWindow,
  sendCommand,
  checkForUpdates,
  checkingForUpdates = false,
  quit,
} = {}) {
  const labels = labelsFor(locale);
  return [
    { label: labels.open, click: () => showWindow?.() },
    {
      label: labels.settings,
      click: () => {
        showWindow?.();
        sendCommand?.(TRAY_COMMANDS.settings);
      },
    },
    {
      id: 'check-for-updates',
      label: checkingForUpdates ? labels.checkingForUpdates : labels.checkForUpdates,
      enabled: !checkingForUpdates,
      click: () => checkForUpdates?.(),
    },
    { type: 'separator' },
    { label: labels.quit, click: () => quit?.() },
  ];
}

/*
 * Keep the native menu in sync with the asynchronous release check. Rebuilding
 * the template is cheap and avoids stale enabled/disabled state in Electron's
 * native menu object.
 */
export function createAppTray({
  Tray,
  Menu,
  nativeImage,
  iconPath,
  locale = 'en',
  getAllWindows,
  createWindow,
  sendCommand,
  checkForUpdates,
  onMenuChange = () => {},
  quit,
} = {}) {
  const icon = nativeImage.createFromPath(iconPath);
  const tray = new Tray(icon);
  const open = () => showMainWindow({ getAllWindows, createWindow });
  let checkingForUpdates = false;
  let inFlight;

  const renderMenu = () => {
    const template = trayMenuTemplate({
      locale,
      showWindow: open,
      sendCommand,
      checkingForUpdates,
      checkForUpdates: () => {
        if (inFlight) return inFlight;
        if (typeof checkForUpdates !== 'function') return undefined;
        checkingForUpdates = true;
        renderMenu();
        try {
          inFlight = Promise.resolve(checkForUpdates());
        } catch (error) {
          inFlight = Promise.reject(error);
        }
        inFlight = inFlight
          .finally(() => {
            inFlight = undefined;
            checkingForUpdates = false;
            renderMenu();
          });
        return inFlight;
      },
      quit,
    });
    tray.setContextMenu(Menu.buildFromTemplate(template));
    onMenuChange(template);
  };

  tray.setToolTip(labelsFor(locale).tooltip);
  renderMenu();
  tray.on('click', open);
  tray.on('right-click', () => tray.popUpContextMenu?.());
  return tray;
}

export function applyCloseToTrayPolicy({ window, isQuitting }) {
  window.on('close', (event) => {
    // A real quit (tray menu, system shutdown, or app.quit()) must proceed.
    if (typeof isQuitting === 'function' && isQuitting()) return;
    event.preventDefault();
    window.hide();
  });
}
