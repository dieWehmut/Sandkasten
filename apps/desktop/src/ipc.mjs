// IPC surface between the sandboxed renderer and the main process. Every
// handler validates its arguments and every filesystem call is confined to the
// folder the user opened through the native dialog.
import {
  createWorkspaceFile,
  deleteWorkspaceFile,
  listWorkspaceTree,
  readWorkspaceFile,
  resolveInsideRoot,
  writeWorkspaceFile,
} from './workspace.mjs';

export const IPC_CHANNELS = {
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

  ipcMain.handle(IPC_CHANNELS.workspaceRemove, async (_event, relativePath) => (
    deleteWorkspaceFile(requireRoot(session), assertString(relativePath, 'path'))
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
