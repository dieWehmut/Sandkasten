// Remote Explorer wiring: the parsed hosts, the directories remembered for each
// one, and the terminal hand-off. The renderer names a host alias and a plain
// absolute directory; the main process composes the ssh command line, so no
// renderer string can ever become shell syntax, and no new spawn surface is
// added: the renderer types the composed line into a real terminal session.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { IPC_CHANNELS } from '../src/ipc.mjs';
import { registerRemoteIpc } from '../src/remote-ipc.mjs';

function fakeIpcMain() {
  const handlers = new Map();
  return {
    handlers,
    handle(channel, handler) { handlers.set(channel, handler); },
    invoke(channel, ...args) {
      const handler = handlers.get(channel);
      if (!handler) throw new Error(`no handler registered for ${channel}`);
      return handler({ senderFrame: { url: 'file:///index.html' } }, ...args);
    },
  };
}

const CONFIG = ['Host sandkasten', '  HostName 192.168.50.11', '  User root', '  Port 2222', '', 'Host bare', ''].join('\n');

async function harness(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sandkasten-remote-ipc-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const configPath = path.join(root, 'config');
  const storePath = path.join(root, 'remote-hosts.json');
  await writeFile(configPath, CONFIG);
  const ipcMain = fakeIpcMain();
  registerRemoteIpc({ ipcMain, configPath, storePath });
  return { root, ipcMain, configPath, storePath };
}

test('lists the parsed hosts with the directories remembered for each one', async (t) => {
  const { ipcMain } = await harness(t);
  const listed = await ipcMain.invoke(IPC_CHANNELS.remoteList);
  assert.equal(listed.available, true);
  assert.deepEqual(listed.hosts.map((host) => host.alias), ['sandkasten', 'bare']);
  assert.deepEqual(listed.hosts[0].directories, []);

  await ipcMain.invoke(IPC_CHANNELS.remoteRemember, { host: 'sandkasten', directory: '/root/sandkasten' });
  const afterRemember = await ipcMain.invoke(IPC_CHANNELS.remoteList);
  assert.deepEqual(afterRemember.hosts[0].directories, ['/root/sandkasten']);

  await ipcMain.invoke(IPC_CHANNELS.remoteForget, { host: 'sandkasten', directory: '/root/sandkasten' });
  const afterForget = await ipcMain.invoke(IPC_CHANNELS.remoteList);
  assert.deepEqual(afterForget.hosts[0].directories, []);
});

test('composes the ssh line for a host and for a remembered directory', async (t) => {
  const { ipcMain } = await harness(t);
  await ipcMain.invoke(IPC_CHANNELS.remoteRemember, { host: 'sandkasten', directory: '/root/sandkasten' });

  const plain = await ipcMain.invoke(IPC_CHANNELS.remoteOpen, { host: 'sandkasten' });
  assert.equal(plain.command, 'ssh -p 2222 root@192.168.50.11');
  assert.equal(plain.directory, '');

  const directory = await ipcMain.invoke(IPC_CHANNELS.remoteOpen, { host: 'sandkasten', directory: '/root/sandkasten' });
  assert.equal(directory.command, "ssh -p 2222 -t root@192.168.50.11 'cd /root/sandkasten && exec $SHELL -l'");
  assert.equal(directory.directory, '/root/sandkasten');
  assert.equal(directory.host, 'sandkasten');
});

test('quotes the remote line for cmd, which has no single-quote syntax', async (t) => {
  const { ipcMain } = await harness(t);
  await ipcMain.invoke(IPC_CHANNELS.remoteRemember, { host: 'bare', directory: '/srv/app' });

  const opened = await ipcMain.invoke(IPC_CHANNELS.remoteOpen, {
    host: 'bare', directory: '/srv/app', profileId: 'cmd',
  });
  assert.equal(opened.command, 'ssh -t bare "cd /srv/app && exec $SHELL -l"');
});

test('refuses an unknown host and a directory that is not a plain absolute path', async (t) => {
  const { ipcMain } = await harness(t);
  await assert.rejects(() => ipcMain.invoke(IPC_CHANNELS.remoteOpen, { host: 'nowhere' }), /unknown remote host/);
  await assert.rejects(
    () => ipcMain.invoke(IPC_CHANNELS.remoteRemember, { host: 'sandkasten', directory: '/root/$(whoami)' }),
    /path/,
  );
  await assert.rejects(
    () => ipcMain.invoke(IPC_CHANNELS.remoteOpen, { host: 'sandkasten', directory: '/root/x; rm -rf /' }),
    /path/,
  );
});

test('never rewrites the SSH config: only the remembered directory store changes', async (t) => {
  const { ipcMain, configPath } = await harness(t);
  const before = await readFile(configPath, 'utf8');
  await ipcMain.invoke(IPC_CHANNELS.remoteRemember, { host: 'sandkasten', directory: '/root/sandkasten' });
  await ipcMain.invoke(IPC_CHANNELS.remoteOpen, { host: 'sandkasten' });
  assert.equal(await readFile(configPath, 'utf8'), before);
});
