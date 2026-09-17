// Application menu for the desktop workbench. Menu items do not touch the
// renderer directly; they forward a stable command id so the web bundle decides
// what a command means.
export const MENU_COMMANDS = {
  openWorkspace: 'workspace.open',
  newFile: 'file.new',
  save: 'file.save',
  closeTab: 'file.closeTab',
  run: 'run.start',
  stop: 'run.stop',
  toggleSidebar: 'view.toggleSidebar',
  togglePanel: 'view.togglePanel',
  setup: 'view.toggleSetup',
  github: 'help.github',
};

export function buildMenuTemplate({ send, platform = process.platform } = {}) {
  if (typeof send !== 'function') throw new Error('a command sender is required');
  const command = (id) => () => send(id);

  const template = [];

  if (platform === 'darwin') {
    template.push({ role: 'appMenu' });
  }

  template.push({
    label: 'File',
    submenu: [
      { label: 'Open Folder…', accelerator: 'CmdOrCtrl+O', click: command(MENU_COMMANDS.openWorkspace) },
      { label: 'New File', accelerator: 'CmdOrCtrl+N', click: command(MENU_COMMANDS.newFile) },
      { label: 'Save File', accelerator: 'CmdOrCtrl+S', click: command(MENU_COMMANDS.save) },
      { label: 'Close Editor', accelerator: 'CmdOrCtrl+W', click: command(MENU_COMMANDS.closeTab) },
      { type: 'separator' },
      platform === 'darwin' ? { role: 'close' } : { role: 'quit' },
    ],
  });

  template.push({
    label: 'Run',
    submenu: [
      { label: 'Run Active File', accelerator: 'F5', click: command(MENU_COMMANDS.run) },
      { label: 'Stop Run', accelerator: 'Shift+F5', click: command(MENU_COMMANDS.stop) },
    ],
  });

  template.push({
    label: 'View',
    submenu: [
      { label: 'Toggle Sidebar', accelerator: 'CmdOrCtrl+B', click: command(MENU_COMMANDS.toggleSidebar) },
      { label: 'Toggle Output Panel', accelerator: 'CmdOrCtrl+J', click: command(MENU_COMMANDS.togglePanel) },
      { type: 'separator' },
      { role: 'reload' },
      { role: 'toggleDevTools' },
      { type: 'separator' },
      { role: 'resetZoom' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
      { type: 'separator' },
      { role: 'togglefullscreen' },
    ],
  });

  template.push({
    label: 'Help',
    submenu: [
      { label: 'Setup Guide', click: command(MENU_COMMANDS.setup) },
      { label: 'Sandkasten on GitHub', click: command(MENU_COMMANDS.github) },
    ],
  });

  return template;
}