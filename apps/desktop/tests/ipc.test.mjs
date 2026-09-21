import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { IPC_CHANNELS, registerDesktopIpc, resolveInitialWorkspace } from '../src/ipc.mjs';
import { createWorkspaceSession } from '../src/workspace.mjs';

function fakeIpcMain() {
  const handlers = new Map();
  return {
    handlers,
    handle(channel, handler) {
      handlers.set(channel, handler);
    },
    invoke(channel, ...args) {
      const handler = handlers.get(channel);
      if (!handler) throw new Error(`no handler registered for ${channel}`);
      return handler({ senderFrame: {} }, ...args);
    },
  };
}

async function harness(t, { runner = {}, isolated } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sandkasten-ipc-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, 'main.py'), 'print("ipc")\n');
  const ipcMain = fakeIpcMain();
  const session = createWorkspaceSession();
  const localRunner = {
    detect: async () => [{ language: 'python', label: 'Python', command: 'python', available: true, extensions: ['.py'] }],
    run: async (request) => ({ jobId: request.jobId, status: 'JOB_STATUS_SUCCEEDED', language: request.language, stdout: 'ipc\n', stderr: '' }),
    stop: async (jobId) => jobId === 'job-1',
    ...runner,
  };
  registerDesktopIpc({
    ipcMain,
    dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
    runner: localRunner,
    isolated,
    session,
    getWindow: () => undefined,
  });
  return { root, ipcMain, session, localRunner };
}

test('workspace IPC requires an opened folder and confines every path', async (t) => {
  const { root, ipcMain, session } = await harness(t);

  assert.deepEqual(await ipcMain.invoke(IPC_CHANNELS.workspaceList), [], 'a closed workspace lists no files');
  await assert.rejects(() => ipcMain.invoke(IPC_CHANNELS.workspaceRead, 'main.py'), /open a workspace folder/i);

  await session.setRoot(root);
  const tree = await ipcMain.invoke(IPC_CHANNELS.workspaceList);
  assert.deepEqual(tree.map((node) => node.path), ['main.py']);
  assert.equal(await ipcMain.invoke(IPC_CHANNELS.workspaceRead, 'main.py'), 'print("ipc")\n');

  await assert.rejects(() => ipcMain.invoke(IPC_CHANNELS.workspaceRead, '../secret.txt'), /workspace/i);
  await assert.rejects(() => ipcMain.invoke(IPC_CHANNELS.workspaceRead, ''), /non-empty string/);
  await assert.rejects(() => ipcMain.invoke(IPC_CHANNELS.workspaceWrite, 'main.py', 42), /content must be a non-empty string|content must be a string/i);

  await ipcMain.invoke(IPC_CHANNELS.workspaceWrite, 'main.py', 'print("written")\n');
  assert.equal(await ipcMain.invoke(IPC_CHANNELS.workspaceRead, 'main.py'), 'print("written")\n');
  await ipcMain.invoke(IPC_CHANNELS.workspaceCreate, 'extra.py', 'print("extra")\n');
  assert.equal(await ipcMain.invoke(IPC_CHANNELS.workspaceRead, 'extra.py'), 'print("extra")\n');
  await ipcMain.invoke(IPC_CHANNELS.workspaceRemove, 'extra.py');
  await assert.rejects(() => ipcMain.invoke(IPC_CHANNELS.workspaceRead, 'extra.py'), /not found/);

  // Search runs in the main process, so the renderer only sends the query and
  // the case flag; the walk and its bounds never leave this side.
  await ipcMain.invoke(IPC_CHANNELS.workspaceCreateFolder, 'pkg');
  await ipcMain.invoke(IPC_CHANNELS.workspaceCreate, 'pkg/extra.py', 'print("needle")\n');
  const found = await ipcMain.invoke(IPC_CHANNELS.workspaceSearch, { query: 'needle' });
  assert.deepEqual(found.files.map((file) => file.path), ['pkg/extra.py']);
  assert.equal(found.fileCount, 1);
  assert.equal(found.matchCount, 1);
  assert.equal((await ipcMain.invoke(IPC_CHANNELS.workspaceSearch, { query: 'NEEDLE' })).fileCount, 1);
  assert.equal((await ipcMain.invoke(IPC_CHANNELS.workspaceSearch, { query: 'NEEDLE', caseSensitive: true })).fileCount, 0);
  await assert.rejects(() => ipcMain.invoke(IPC_CHANNELS.workspaceSearch, { query: '  ' }), /query/i);
  await assert.rejects(() => ipcMain.invoke(IPC_CHANNELS.workspaceSearch, {}), /query/i);
});

test('the folder dialog opens exactly one directory and reports cancellation', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sandkasten-ipc-open-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  async function invokeWithDialog(dialogResult) {
    const ipcMain = fakeIpcMain();
    const session = createWorkspaceSession();
    let seenOptions;
    registerDesktopIpc({
      ipcMain,
      dialog: {
        async showOpenDialog(...args) {
          seenOptions = args.at(-1);
          return dialogResult;
        },
      },
      runner: { detect: async () => [], run: async () => ({}), stop: async () => false },
      session,
      getWindow: () => undefined,
    });
    return { result: await ipcMain.invoke(IPC_CHANNELS.workspaceOpenFolder), session, ipcMain, options: () => seenOptions };
  }

  const canceled = await invokeWithDialog({ canceled: true, filePaths: [] });
  assert.equal(canceled.result, null, 'a canceled dialog keeps the workspace closed');
  assert.equal(canceled.session.root, undefined);

  const selected = await invokeWithDialog({ canceled: false, filePaths: [root] });
  assert.deepEqual(selected.options().properties, ['openDirectory', 'createDirectory']);
  assert.equal(selected.result.path, path.resolve(root));
  assert.equal(selected.result.name, path.basename(root));
  assert.equal((await selected.ipcMain.invoke(IPC_CHANNELS.workspaceRoot)).path, path.resolve(root));

  const empty = await invokeWithDialog({ canceled: false, filePaths: [] });
  assert.equal(empty.result, null);
});

test('local execution IPC validates its request and forwards to the runner', async (t) => {
  const { root, ipcMain, session } = await harness(t);
  const detected = await ipcMain.invoke(IPC_CHANNELS.localDetect);
  assert.equal(detected[0].language, 'python');

  await assert.rejects(() => ipcMain.invoke(IPC_CHANNELS.localRun, { jobId: 'job-1', path: 'main.py', language: 'python' }), /open a workspace folder/i);
  await session.setRoot(root);
  await assert.rejects(() => ipcMain.invoke(IPC_CHANNELS.localRun, null), /local run request/);
  await assert.rejects(() => ipcMain.invoke(IPC_CHANNELS.localRun, { jobId: '', path: 'main.py', language: 'python' }), /jobId/);
  await assert.rejects(() => ipcMain.invoke(IPC_CHANNELS.localRun, { jobId: 'job-1', path: 'main.py', language: '' }), /language/);

  const result = await ipcMain.invoke(IPC_CHANNELS.localRun, { jobId: 'job-1', path: 'main.py', language: 'python' });
  assert.equal(result.stdout, 'ipc\n');
  assert.equal(await ipcMain.invoke(IPC_CHANNELS.localStop, 'job-1'), true);
  assert.equal(await ipcMain.invoke(IPC_CHANNELS.localStop, 'job-2'), false);
  await assert.rejects(() => ipcMain.invoke(IPC_CHANNELS.localStop, ''), /jobId/);
});

test('isolated execution resolves the path inside the root and forwards the request', async (t) => {
  const seen = [];
  const isolated = {
    detect: async () => ({ available: true, distro: 'Ubuntu-22.04', pidIsolated: true, networkBlocked: true }),
    run: async (request, context) => {
      seen.push({ request, context });
      return { jobId: request.jobId, status: 'JOB_STATUS_SUCCEEDED', language: request.language, stdout: 'sandboxed\n', stderr: '' };
    },
    stop: async (jobId) => jobId === 'job-9',
  };
  const { root, ipcMain, session } = await harness(t, { isolated });

  assert.deepEqual(
    await ipcMain.invoke(IPC_CHANNELS.isolatedDetect),
    { available: true, distro: 'Ubuntu-22.04', pidIsolated: true, networkBlocked: true },
  );

  await assert.rejects(() => ipcMain.invoke(IPC_CHANNELS.isolatedRun, { jobId: 'job-9', path: 'main.py', language: 'python', command: 'python3' }), /open a workspace folder/i);
  await session.setRoot(root);
  await assert.rejects(() => ipcMain.invoke(IPC_CHANNELS.isolatedRun, null), /isolated run request/);
  await assert.rejects(() => ipcMain.invoke(IPC_CHANNELS.isolatedRun, { jobId: '', path: 'main.py', language: 'python', command: 'python3' }), /jobId/);
  await assert.rejects(() => ipcMain.invoke(IPC_CHANNELS.isolatedRun, { jobId: 'job-9', path: 'main.py', language: 'python' }), /command/);
  await assert.rejects(() => ipcMain.invoke(IPC_CHANNELS.isolatedRun, { jobId: 'job-9', path: '../escape.py', language: 'python', command: 'python3' }), /workspace/i);

  const result = await ipcMain.invoke(IPC_CHANNELS.isolatedRun, { jobId: 'job-9', path: 'main.py', language: 'python', command: 'python3' });
  assert.equal(result.stdout, 'sandboxed\n');
  assert.equal(seen.length, 1);
  assert.equal(seen[0].request.absolutePath, path.join(path.resolve(root), 'main.py'));
  assert.deepEqual(seen[0].request.args, ['{file}'], 'a missing arg list defaults to the file placeholder');
  assert.equal(seen[0].context.root, path.resolve(root));

  assert.equal(await ipcMain.invoke(IPC_CHANNELS.isolatedStop, 'job-9'), true);
  assert.equal(await ipcMain.invoke(IPC_CHANNELS.isolatedStop, 'other'), false);
  await assert.rejects(() => ipcMain.invoke(IPC_CHANNELS.isolatedStop, ''), /jobId/);
});

test('a build without an isolated runner reports it as unavailable instead of failing', async (t) => {
  const { ipcMain } = await harness(t);
  assert.deepEqual(
    await ipcMain.invoke(IPC_CHANNELS.isolatedDetect),
    { available: false, distro: '', pidIsolated: false, networkBlocked: false },
  );
  assert.equal(await ipcMain.invoke(IPC_CHANNELS.isolatedStop, 'job-1'), false);
  await assert.rejects(() => ipcMain.invoke(IPC_CHANNELS.isolatedRun, { jobId: 'job-1', path: 'main.py', language: 'python', command: 'python3' }), /not available in this build/i);
});

test('the initial workspace honours the environment override before the stored folder', async (t) => {
  const first = await mkdtemp(path.join(os.tmpdir(), 'sandkasten-initial-'));
  const second = await mkdtemp(path.join(os.tmpdir(), 'sandkasten-initial-'));
  const store = await mkdtemp(path.join(os.tmpdir(), 'sandkasten-initial-store-'));
  t.after(() => rm(first, { recursive: true, force: true }));
  t.after(() => rm(second, { recursive: true, force: true }));
  t.after(() => rm(store, { recursive: true, force: true }));
  const session = createWorkspaceSession({ storeFile: path.join(store, 'workspace.json') });
  await session.setRoot(first);

  assert.equal((await resolveInitialWorkspace(session, {}))?.path, path.resolve(first));
  assert.equal((await resolveInitialWorkspace(session, { SANDKASTEN_WORKSPACE_ROOT: second }))?.path, path.resolve(second));
  await assert.rejects(
    () => resolveInitialWorkspace(session, { SANDKASTEN_WORKSPACE_ROOT: path.join(os.tmpdir(), 'sandkasten-missing-9') }),
    /not found/,
  );
});
