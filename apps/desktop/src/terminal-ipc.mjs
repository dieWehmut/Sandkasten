import { pathToFileURL } from 'node:url';
import { IPC_CHANNELS } from './ipc.mjs';

export function registerTerminalIpc({ ipcMain, terminal, getWindowForContents, bundledIndex }) {
  const bundledUrl = pathToFileURL(bundledIndex).href;
  const tracked = new WeakSet();
  function trustedOwner(event) {
    const sender = event?.sender;
    const window = sender && getWindowForContents(sender);
    let frameUrl;
    try {
      const url = new URL(event?.senderFrame?.url);
      url.hash = '';
      frameUrl = url.href;
    } catch { /* Missing or malformed URLs are untrusted. */ }
    if (!window || window.isDestroyed() || sender.isDestroyed() || window.webContents !== sender
        || event.senderFrame !== sender.mainFrame || frameUrl !== bundledUrl) {
      throw new Error('Terminal access requires a trusted application frame.');
    }
    if (!tracked.has(sender)) {
      tracked.add(sender);
      const dispose = () => {
        terminal.disposeOwner(sender);
        if (!sender.isDestroyed()) sender.setIgnoreMenuShortcuts(false);
      };
      const navigate = (_event, _url, isInPlace, isMainFrame) => {
        if (isMainFrame && !isInPlace) dispose();
      };
      sender.on('did-start-navigation', navigate);
      sender.on('render-process-gone', dispose);
      sender.once('destroyed', () => {
        dispose();
        sender.removeListener('did-start-navigation', navigate);
        sender.removeListener('render-process-gone', dispose);
      });
    }
    return sender;
  }
  ipcMain.handle(IPC_CHANNELS.terminalProfiles, async (event) => {
    trustedOwner(event);
    return terminal.profiles();
  });
  ipcMain.handle(IPC_CHANNELS.terminalSetFocused, async (event, focused) => {
    const sender = trustedOwner(event);
    if (typeof focused !== 'boolean') throw new Error('Terminal focus must be a boolean.');
    sender.setIgnoreMenuShortcuts(focused);
  });
  for (const [channel, method] of [
    [IPC_CHANNELS.terminalCreate, 'create'], [IPC_CHANNELS.terminalAttach, 'attach'],
    [IPC_CHANNELS.terminalWrite, 'write'], [IPC_CHANNELS.terminalResize, 'resize'],
    [IPC_CHANNELS.terminalClose, 'close'],
  ]) ipcMain.handle(channel, async (event, request) => terminal[method](trustedOwner(event), request));
}
