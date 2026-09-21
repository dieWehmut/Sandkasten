// Sandboxed preload scripts are loaded as CommonJS, so this file must stay .cjs
// even though the rest of the desktop app is ESM.
const { contextBridge, ipcRenderer } = require('electron');

// Keep these channel names in sync with src/ipc.mjs (tests/preload.test.mjs
// fails the build when the two drift apart).
const CHANNELS = {
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
  workspaceStatus: 'sandkasten:workspace:status',
  workspaceStage: 'sandkasten:workspace:stage',
  workspaceCommit: 'sandkasten:workspace:commit',
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

function subscribe(channel, handler) {
  if (typeof handler !== 'function') throw new TypeError('A terminal event handler is required.');
  const listener = (_event, payload) => handler(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

// The renderer stays sandboxed: it only sees this narrow, promise-based bridge.
contextBridge.exposeInMainWorld('sandkastenDesktop', {
  platform: process.platform,
  versions: {
    chrome: process.versions.chrome,
    electron: process.versions.electron,
  },
  windowChrome: {
    integrated: true,
    setTheme: (theme) => ipcRenderer.invoke(CHANNELS.chromeSetTheme, theme),
    showMenu: (request) => ipcRenderer.invoke(CHANNELS.chromeShowMenu, request),
  },
  terminal: {
    profiles: () => ipcRenderer.invoke(CHANNELS.terminalProfiles),
    create: (request) => ipcRenderer.invoke(CHANNELS.terminalCreate, request),
    attach: (id) => ipcRenderer.invoke(CHANNELS.terminalAttach, id),
    write: (request) => ipcRenderer.invoke(CHANNELS.terminalWrite, request),
    resize: (request) => ipcRenderer.invoke(CHANNELS.terminalResize, request),
    close: (id) => ipcRenderer.invoke(CHANNELS.terminalClose, id),
    setFocused: (focused) => ipcRenderer.invoke(CHANNELS.terminalSetFocused, focused),
    onData: (handler) => subscribe(CHANNELS.terminalData, handler),
    onExit: (handler) => subscribe(CHANNELS.terminalExit, handler),
  },
  workspace: {
    openFolder: () => ipcRenderer.invoke(CHANNELS.workspaceOpenFolder),
    root: () => ipcRenderer.invoke(CHANNELS.workspaceRoot),
    list: () => ipcRenderer.invoke(CHANNELS.workspaceList),
    read: (path) => ipcRenderer.invoke(CHANNELS.workspaceRead, path),
    write: (path, content) => ipcRenderer.invoke(CHANNELS.workspaceWrite, path, content),
    create: (path, content) => ipcRenderer.invoke(CHANNELS.workspaceCreate, path, content),
    createFolder: (path) => ipcRenderer.invoke(CHANNELS.workspaceCreateFolder, path),
    remove: (path) => ipcRenderer.invoke(CHANNELS.workspaceRemove, path),
    search: (request) => ipcRenderer.invoke(CHANNELS.workspaceSearch, request),
    status: () => ipcRenderer.invoke(CHANNELS.workspaceStatus),
    stage: (request) => ipcRenderer.invoke(CHANNELS.workspaceStage, request),
    commit: (request) => ipcRenderer.invoke(CHANNELS.workspaceCommit, request),
  },
  remote: {
    list: () => ipcRenderer.invoke(CHANNELS.remoteList),
    remember: (request) => ipcRenderer.invoke(CHANNELS.remoteRemember, request),
    forget: (request) => ipcRenderer.invoke(CHANNELS.remoteForget, request),
    open: (request) => ipcRenderer.invoke(CHANNELS.remoteOpen, request),
  },
  runner: {
    detect: () => ipcRenderer.invoke(CHANNELS.localDetect),
    run: (request) => ipcRenderer.invoke(CHANNELS.localRun, request),
    stop: (jobId) => ipcRenderer.invoke(CHANNELS.localStop, jobId),
  },
  isolated: {
    detect: () => ipcRenderer.invoke(CHANNELS.isolatedDetect),
    run: (request) => ipcRenderer.invoke(CHANNELS.isolatedRun, request),
    stop: (jobId) => ipcRenderer.invoke(CHANNELS.isolatedStop, jobId),
  },
  onMenuCommand: (handler) => {
    if (typeof handler !== 'function') return;
    ipcRenderer.on(CHANNELS.menu, (_event, command) => handler(command));
  },
});
