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

export function buildMenuTemplate({ send, platform = process.platform, locale = 'en' } = {}) {
  if (typeof send !== 'function') throw new Error('a command sender is required');
  const command = (id) => () => send(id);
  const label = (en, zh) => locale === 'zh-CN' ? zh : en;

  const template = [];

  if (platform === 'darwin') {
    template.push({ role: 'appMenu' });
  }

  template.push({
    id: 'file',
    label: label('File', '文件'),
    submenu: [
      { label: label('Open Folder…', '打开文件夹…'), accelerator: 'CmdOrCtrl+O', click: command(MENU_COMMANDS.openWorkspace) },
      { label: label('New File', '新建文件'), accelerator: 'CmdOrCtrl+N', click: command(MENU_COMMANDS.newFile) },
      { label: label('Save File', '保存文件'), accelerator: 'CmdOrCtrl+S', click: command(MENU_COMMANDS.save) },
      { label: label('Close Editor', '关闭编辑器'), accelerator: 'CmdOrCtrl+W', click: command(MENU_COMMANDS.closeTab) },
      // No quit entry off macOS: closing the window hides the app into the tray
      // so a running job survives, and the tray menu owns the real exit.
      ...(platform === 'darwin' ? [{ role: 'close', label: label('Close Window', '关闭窗口') }] : []),
    ],
  });

  template.push({
    id: 'edit',
    label: label('Edit', '编辑'),
    submenu: [
      { role: 'undo', label: label('Undo', '撤销') },
      { role: 'redo', label: label('Redo', '重做') },
      { type: 'separator' },
      { role: 'cut', label: label('Cut', '剪切') },
      { role: 'copy', label: label('Copy', '复制') },
      { role: 'paste', label: label('Paste', '粘贴') },
      { role: 'selectAll', label: label('Select All', '全选') },
    ],
  });

  template.push({
    id: 'run',
    label: label('Run', '运行'),
    submenu: [
      { label: label('Run Active File', '运行当前文件'), accelerator: 'F5', click: command(MENU_COMMANDS.run) },
      { label: label('Stop Run', '停止运行'), accelerator: 'Shift+F5', click: command(MENU_COMMANDS.stop) },
    ],
  });

  template.push({
    id: 'view',
    label: label('View', '视图'),
    submenu: [
      { label: label('Toggle Sidebar', '切换侧边栏'), accelerator: 'CmdOrCtrl+B', click: command(MENU_COMMANDS.toggleSidebar) },
      { label: label('Toggle Output Panel', '切换输出面板'), accelerator: 'CmdOrCtrl+J', click: command(MENU_COMMANDS.togglePanel) },
      { type: 'separator' },
      { role: 'reload', label: label('Reload', '重新加载') },
      { role: 'toggleDevTools', label: label('Toggle Developer Tools', '切换开发者工具') },
      { type: 'separator' },
      { role: 'resetZoom', label: label('Actual Size', '实际大小') },
      { role: 'zoomIn', label: label('Zoom In', '放大') },
      { role: 'zoomOut', label: label('Zoom Out', '缩小') },
      { type: 'separator' },
      { role: 'togglefullscreen', label: label('Toggle Full Screen', '切换全屏') },
    ],
  });

  template.push({
    id: 'help',
    label: label('Help', '帮助'),
    submenu: [
      { label: label('Setup Guide', '设置指南'), click: command(MENU_COMMANDS.setup) },
      { label: label('Sandkasten on GitHub', 'Sandkasten 的 GitHub 仓库'), click: command(MENU_COMMANDS.github) },
    ],
  });

  return template;
}
