// Remote Explorer wiring. The SSH config is read-only for this feature and the
// remembered directories live in the app's own store. Selecting an entry
// returns the ssh line the renderer types into a real terminal session, so the
// renderer can only ever name a parsed host alias and a plain absolute path.
import { listRemoteHosts, openRemoteSession, rememberRemoteDirectory, forgetRemoteDirectory } from './remote.mjs';
import { IPC_CHANNELS } from './ipc.mjs';

export function registerRemoteIpc({ ipcMain, configPath, storePath }) {
  ipcMain.handle(IPC_CHANNELS.remoteList, async () => listRemoteHosts({ configPath, storePath }));

  ipcMain.handle(IPC_CHANNELS.remoteRemember, async (_event, request) => {
    await rememberRemoteDirectory(storePath, {
      host: request?.host,
      directory: request?.directory,
    });
    return listRemoteHosts({ configPath, storePath });
  });

  ipcMain.handle(IPC_CHANNELS.remoteForget, async (_event, request) => {
    await forgetRemoteDirectory(storePath, {
      host: request?.host,
      directory: request?.directory,
    });
    return listRemoteHosts({ configPath, storePath });
  });

  ipcMain.handle(IPC_CHANNELS.remoteOpen, async (_event, request) => {
    const { hosts } = await listRemoteHosts({ configPath, storePath });
    return openRemoteSession({
      hosts,
      host: request?.host,
      directory: request?.directory,
      profileId: request?.profileId,
    });
  });

  return IPC_CHANNELS;
}
