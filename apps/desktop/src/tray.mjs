// Taskbar tray integration. Closing the window must not end a running task, so
// the app keeps living in the tray and only the explicit tray quit exits.
import path from 'node:path';

const LABELS = {
  en: {
    tooltip: 'Sandkasten',
    open: 'Open Sandkasten',
    settings: 'Settings',
    setup: 'Setup Guide',
    apiEndpoint: 'API Endpoint',
    toggleTheme: 'Toggle Theme',
    quit: 'Quit Sandkasten',
  },
  'zh-CN': {
    tooltip: 'Sandkasten',
    open: '打开 Sandkasten',
    settings: '设置',
    setup: '安装指南',
    apiEndpoint: 'API 地址',
    toggleTheme: '切换主题',
    quit: '退出 Sandkasten',
  },
};

export const TRAY_COMMANDS = {
  setup: 'view.toggleSetup',
  apiEndpoint: 'apiEndpoint.open',
  toggleTheme: 'theme.toggle',
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

export function trayMenuTemplate({ locale = 'en', showWindow, sendCommand, quit } = {}) {
  const labels = labelsFor(locale);
  const command = (id) => () => sendCommand?.(id);
  return [
    { label: labels.open, click: () => showWindow?.() },
    {
      label: labels.settings,
      submenu: [
        { label: labels.setup, click: command(TRAY_COMMANDS.setup) },
        { label: labels.apiEndpoint, click: command(TRAY_COMMANDS.apiEndpoint) },
        { type: 'separator' },
        { label: labels.toggleTheme, click: command(TRAY_COMMANDS.toggleTheme) },
      ],
    },
    { type: 'separator' },
    { label: labels.quit, click: () => quit?.() },
  ];
}

export function applyCloseToTrayPolicy({ window, isQuitting }) {
  window.on('close', (event) => {
    // A real quit (tray menu, system shutdown, or app.quit()) must proceed.
    if (typeof isQuitting === 'function' && isQuitting()) return;
    event.preventDefault();
    window.hide();
  });
}

export function createAppTray({
  Tray,
  Menu,
  nativeImage,
  iconPath,
  locale = 'en',
  getAllWindows,
  createWindow,
  sendCommand,
  quit,
} = {}) {
  const icon = nativeImage.createFromPath(iconPath);
  const tray = new Tray(icon);
  const open = () => showMainWindow({ getAllWindows, createWindow });
  tray.setToolTip(labelsFor(locale).tooltip);
  tray.setContextMenu(Menu.buildFromTemplate(trayMenuTemplate({ locale, showWindow: open, sendCommand, quit })));
  tray.on('click', open);
  tray.on('right-click', () => tray.popUpContextMenu?.());
  return tray;
}