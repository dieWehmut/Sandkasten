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
  workspaceRemove: 'sandkasten:workspace:remove',
  localDetect: 'sandkasten:local:detect',
  localRun: 'sandkasten:local:run',
  localStop: 'sandkasten:local:stop',
  isolatedDetect: 'sandkasten:isolated:detect',
  isolatedRun: 'sandkasten:isolated:run',
  isolatedStop: 'sandkasten:isolated:stop',
  menu: 'sandkasten:menu',
};

// The renderer stays sandboxed: it only sees this narrow, promise-based bridge.
contextBridge.exposeInMainWorld('sandkastenDesktop', {
  platform: process.platform,
  versions: {
    chrome: process.versions.chrome,
    electron: process.versions.electron,
  },
  workspace: {
    openFolder: () => ipcRenderer.invoke(CHANNELS.workspaceOpenFolder),
    root: () => ipcRenderer.invoke(CHANNELS.workspaceRoot),
    list: () => ipcRenderer.invoke(CHANNELS.workspaceList),
    read: (path) => ipcRenderer.invoke(CHANNELS.workspaceRead, path),
    write: (path, content) => ipcRenderer.invoke(CHANNELS.workspaceWrite, path, content),
    create: (path, content) => ipcRenderer.invoke(CHANNELS.workspaceCreate, path, content),
    remove: (path) => ipcRenderer.invoke(CHANNELS.workspaceRemove, path),
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
