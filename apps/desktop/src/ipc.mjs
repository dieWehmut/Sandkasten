// IPC surface between the sandboxed renderer and the main process. Every
// handler validates its arguments and every filesystem call is confined to the
// folder the user opened through the native dialog.
import { pathToFileURL } from 'node:url';

import { buildMenuTemplate } from './menu.mjs';
import { WINDOW_CHROME_THEMES } from './navigation.mjs';
import {
  createWorkspaceFile,
  createWorkspaceFolder,
  deleteWorkspaceFile,
  listWorkspaceTree,
  readWorkspaceFile,
  resolveInsideRoot,
  writeWorkspaceFile,
} from './workspace.mjs';
import { searchWorkspaceFiles } from './workspace-search.mjs';

export const IPC_CHANNELS = {
  workspaceOpenFolder: 'sandkasten:workspace:open-folder',
  workspaceRoot: 'sandkasten:workspace:root',
  workspaceList: 'sandkasten:workspace:list',
  workspaceRead: 'sandkasten:workspace:read',
  workspaceWrite: 'sandkasten:workspace:write',
  workspaceCreate: 'sandkasten:workspace:create',
  workspaceCreateFolder: 'sandkasten:workspace:create-folder',
  workspaceRemove: 'sandkasten:workspace:remove',
  workspaceSearch: 'sandkasten:workspace:search',
  remoteList: 'sandkasten:remote:list',
  remoteRemember: 'sandkasten:remote:remember',
  remoteForget: 'sandkasten:remote:forget',
  remoteOpen: 'sandkasten:remote:open',
  localDetect: 'sandkasten:local:detect',
  localRun: 'sandkasten:local:run',
  localStop: 'sandkasten:local:stop',
  isolatedDetect: 'sandkasten:isolated:detect',
  isolatedRun: 'sandkasten:isolated:run',
  isolatedStop: 'sandkasten:isolated:stop',
  chromeSetTheme: 'sandkasten:chrome:set-theme',
  chromeShowMenu: 'sandkasten:chrome:show-menu',
  terminalProfiles: 'sandkasten:terminal:profiles',
  terminalCreate: 'sandkasten:terminal:create',
  terminalAttach: 'sandkasten:terminal:attach',
  terminalWrite: 'sandkasten:terminal:write',
  terminalResize: 'sandkasten:terminal:resize',
  terminalClose: 'sandkasten:terminal:close',
  terminalSetFocused: 'sandkasten:terminal:set-focused',
  terminalData: 'sandkasten:terminal:data',
  terminalExit: 'sandkasten:terminal:exit',
  menu: 'sandkasten:menu',
};

function assertString(value, label, { allowEmpty = false } = {}) {
  if (typeof value !== 'string' || (!allowEmpty && value.trim() === '')) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function requireRoot(session) {
  const root = session.root;
  if (!root) throw new Error('Open a workspace folder before using the local workspace.');
  return root;
}

export async function resolveInitialWorkspace(session, environment = process.env) {
  const requested = environment.SANDKASTEN_WORKSPACE_ROOT;
  if (typeof requested === 'string' && requested.trim() !== '') {
    return session.setRoot(requested.trim());
  }
  return session.restore();
}

export function registerWindowChromeIpc({ ipcMain, Menu, getWindowForContents, bundledIndex, platform = process.platform }) {
  const bundledUrl = pathToFileURL(bundledIndex).href;
  const trustedWindow = (event) => {
    const sender = event?.sender;
    const window = sender && getWindowForContents(sender);
    let frameUrl;
    try {
      const url = new URL(event?.senderFrame?.url);
      url.hash = '';
      frameUrl = url.href;
    } catch {
      // Malformed or missing frame URLs are never trusted.
    }
    if (!window || window.isDestroyed() || window.webContents !== sender
        || event?.senderFrame !== sender.mainFrame || frameUrl !== bundledUrl) {
      throw new Error('Window chrome requires a trusted application frame.');
    }
    return window;
  };

  ipcMain.handle(IPC_CHANNELS.chromeSetTheme, async (event, theme) => {
    const window = trustedWindow(event);
    if (theme !== 'light' && theme !== 'dark') throw new Error('Invalid window chrome theme.');
    const overlay = WINDOW_CHROME_THEMES[theme];
    if (platform !== 'darwin') window.setTitleBarOverlay({ ...overlay });
    window.setBackgroundColor(overlay.color);
  });

  ipcMain.handle(IPC_CHANNELS.chromeShowMenu, async (event, request) => {
    const window = trustedWindow(event);
    if (!request || typeof request !== 'object' || Array.isArray(request)
        || !['file', 'edit', 'view', 'help'].includes(request.id)) {
      throw new Error('Invalid window menu.');
    }
    if (request.locale !== 'en' && request.locale !== 'zh-CN') throw new Error('Invalid menu locale.');
    const zoom = window.webContents.getZoomFactor();
    const [width, height] = window.getContentSize();
    if (![request.x, request.y].every((value) => typeof value === 'number' && Number.isFinite(value) && value >= 0)
        || request.x * zoom > width || request.y * zoom > height) {
      throw new Error('Invalid menu anchor.');
    }
    const template = buildMenuTemplate({
      locale: request.locale,
      platform,
      send: (command) => {
        if (!window.isDestroyed()) window.webContents.send(IPC_CHANNELS.menu, command);
      },
    });
    const submenu = template.find((entry) => entry.id === request.id).submenu;
    const menu = Menu.buildFromTemplate(submenu);
    await new Promise((resolve) => menu.popup({
      window,
      frame: event.senderFrame,
      x: Math.min(width - 1, Math.round(request.x * zoom)),
      y: Math.min(height - 1, Math.round(request.y * zoom)),
      callback: resolve,
    }));
  });
}

export function registerDesktopIpc({ ipcMain, dialog, runner, isolated, session, getWindow }) {
  ipcMain.handle(IPC_CHANNELS.workspaceOpenFolder, async () => {
    const options = {
      title: 'Open workspace folder',
      properties: ['openDirectory', 'createDirectory'],
    };
    const window = getWindow?.();
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths?.length) return null;
    return session.setRoot(result.filePaths[0]);
  });

  ipcMain.handle(IPC_CHANNELS.workspaceRoot, async () => session.current());

  ipcMain.handle(IPC_CHANNELS.workspaceList, async () => {
    const root = session.root;
    if (!root) return [];
    const { tree } = await listWorkspaceTree(root);
    return tree;
  });

  ipcMain.handle(IPC_CHANNELS.workspaceRead, async (_event, relativePath) => (
    readWorkspaceFile(requireRoot(session), assertString(relativePath, 'path'))
  ));

  ipcMain.handle(IPC_CHANNELS.workspaceWrite, async (_event, relativePath, content) => (
    writeWorkspaceFile(requireRoot(session), assertString(relativePath, 'path'), assertString(content, 'content', { allowEmpty: true }))
  ));

  ipcMain.handle(IPC_CHANNELS.workspaceCreate, async (_event, relativePath, content = '') => (
    createWorkspaceFile(requireRoot(session), assertString(relativePath, 'path'), assertString(content, 'content', { allowEmpty: true }))
  ));

  ipcMain.handle(IPC_CHANNELS.workspaceCreateFolder, async (_event, relativePath) => (
    createWorkspaceFolder(requireRoot(session), assertString(relativePath, 'path'))
  ));

  ipcMain.handle(IPC_CHANNELS.workspaceRemove, async (_event, relativePath) => (
    deleteWorkspaceFile(requireRoot(session), assertString(relativePath, 'path'))
  ));

  // The renderer names the query and whether it wants case sensitivity; the
  // main process owns the walk, the bounds, and the ignored directories.
  ipcMain.handle(IPC_CHANNELS.workspaceSearch, async (_event, request) => (
    searchWorkspaceFiles(requireRoot(session), assertString(request?.query, 'query'), {
      caseSensitive: request?.caseSensitive === true,
    })
  ));

  ipcMain.handle(IPC_CHANNELS.localDetect, async () => runner.detect());

  ipcMain.handle(IPC_CHANNELS.localRun, async (_event, request) => {
    if (!request || typeof request !== 'object') throw new Error('a local run request is required');
    const root = requireRoot(session);
    return runner.run({
      jobId: assertString(request.jobId, 'jobId'),
      path: assertString(request.path, 'path'),
      language: assertString(request.language, 'language'),
      timeoutMs: request.timeoutMs,
    }, { root });
  });

  ipcMain.handle(IPC_CHANNELS.localStop, async (_event, jobId) => runner.stop(assertString(jobId, 'jobId')));

  ipcMain.handle(IPC_CHANNELS.isolatedDetect, async () => (
    isolated ? isolated.detect() : { available: false, distro: '', pidIsolated: false, networkBlocked: false }
  ));

  ipcMain.handle(IPC_CHANNELS.isolatedRun, async (_event, request) => {
    if (!isolated) throw new Error('Isolated execution is not available in this build.');
    if (!request || typeof request !== 'object') throw new Error('an isolated run request is required');
    const root = requireRoot(session);
    const relativePath = assertString(request.path, 'path');
    return isolated.run({
      jobId: assertString(request.jobId, 'jobId'),
      path: relativePath,
      absolutePath: resolveInsideRoot(root, relativePath),
      language: assertString(request.language, 'language'),
      command: assertString(request.command, 'command'),
      args: Array.isArray(request.args) ? request.args.map((argument) => String(argument)) : ['{file}'],
      timeoutMs: request.timeoutMs,
    }, { root });
  });

  ipcMain.handle(IPC_CHANNELS.isolatedStop, async (_event, jobId) => (
    isolated ? isolated.stop(assertString(jobId, 'jobId')) : false
  ));

  return IPC_CHANNELS;
}
