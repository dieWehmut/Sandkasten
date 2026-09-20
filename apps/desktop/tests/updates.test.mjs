import assert from 'node:assert/strict';
import test from 'node:test';
import { compareVersions, checkForRelease, createUpdateChecker, RELEASE_API_URL } from '../src/updates.mjs';

const release = (tag = 'v0.2.0', extra = {}) => ({ tag_name: tag, draft: false, prerelease: false, ...extra });
const response = (body, status = 200) => new Response(JSON.stringify(body), { status });

test('compares numeric version segments and prereleases without treating build metadata as an update', () => {
  assert.equal(compareVersions('v0.10.0', '0.9.9'), 1);
  assert.equal(compareVersions('0.1.0+local', 'v0.1.0'), 0);
  assert.equal(compareVersions('0.1.0-rc.2', '0.1.0-rc.10'), -1);
  assert.equal(compareVersions('0.1.0', '0.1.0-rc.10'), 1);
  assert.equal(compareVersions('0.1.0-alpha', '0.1.0-alpha.1'), -1);
  assert.throws(() => compareVersions('not-a-version', '0.1.0'), /version/i);
});

test('queries the fixed latest stable release API without credentials and constructs a trusted release link', async () => {
  let request;
  const result = await checkForRelease({ currentVersion: '0.1.0', fetchImpl: async (url, options) => {
    request = { url, options };
    return response(release('v0.2.0', { html_url: 'https://untrusted.example/download' }));
  } });
  assert.equal(request.url, RELEASE_API_URL);
  assert.equal(request.url, 'https://api.github.com/repos/dieWehmut/Sandkasten/releases/latest');
  assert.equal(request.options.headers.Accept, 'application/vnd.github+json');
  assert.equal(request.options.headers.Authorization, undefined);
  assert.ok(request.options.signal instanceof AbortSignal);
  assert.deepEqual(result, {
    status: 'available', currentVersion: '0.1.0', latestVersion: '0.2.0',
    url: 'https://github.com/dieWehmut/Sandkasten/releases/tag/v0.2.0',
  });
});

test('distinguishes the current release, a newer local build, and absent stable releases', async () => {
  for (const [tag, status] of [['v0.1.0', 'current'], ['v0.0.9', 'ahead']]) {
    assert.equal((await checkForRelease({ currentVersion: '0.1.0', fetchImpl: async () => response(release(tag)) })).status, status);
  }
  for (const [body, code] of [[{}, 404], [release('v0.2.0', { draft: true }), 200], [release('v0.2.0-rc.1', { prerelease: true }), 200]]) {
    assert.equal((await checkForRelease({ currentVersion: '0.1.0', fetchImpl: async () => response(body, code) })).status, 'no-release');
  }
});

test('reports GitHub errors and malformed tags instead of claiming the app is current', async () => {
  await assert.rejects(checkForRelease({ currentVersion: '0.1.0', fetchImpl: async () => response({}, 403) }), /403/);
  await assert.rejects(checkForRelease({ currentVersion: '0.1.0', fetchImpl: async () => response(release('../other')) }), /version/i);
  await assert.rejects(checkForRelease({ currentVersion: '0.1.0', fetchImpl: async () => response({}) }), /version/i);
});

test('aborts a stalled release request within the configured deadline', async () => {
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    await assert.rejects(checkForRelease({ currentVersion: '0.1.0', timeoutMs: 15, fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }) }), /timeout|aborted/i);
  } finally { clearTimeout(keepAlive); }
});

test('coalesces repeated tray clicks and opens a release only after choosing its download action', async () => {
  let resolveFetch;
  let calls = 0;
  const states = [];
  const dialogs = [];
  const opened = [];
  const checker = createUpdateChecker({
    currentVersion: '0.1.0', locale: 'zh-CN',
    fetchImpl: () => { calls++; return new Promise((resolve) => { resolveFetch = resolve; }); },
    onCheckingChange: (checking) => states.push(checking),
    showMessageBox: async (options) => { dialogs.push(options); return { response: 0 }; },
    openExternal: async (url) => opened.push(url),
  });
  const first = checker.check();
  const second = checker.check();
  assert.equal(calls, 1);
  assert.equal(opened.length, 0);
  resolveFetch(response(release()));
  await Promise.all([first, second]);
  assert.deepEqual(states, [true, false]);
  assert.equal(dialogs.length, 1);
  assert.match(dialogs[0].message, /发现新版本/);
  assert.match(dialogs[0].detail, /0\.1\.0/);
  assert.match(dialogs[0].detail, /0\.2\.0/);
  assert.equal(dialogs[0].cancelId, 1);
  assert.deepEqual(opened, ['https://github.com/dieWehmut/Sandkasten/releases/tag/v0.2.0']);
});

test('cancel, current, ahead, absent release and offline outcomes never open a download', async () => {
  for (const kind of ['cancel', 'current', 'ahead', 'no-release', 'offline']) {
    const dialogs = [];
    const checker = createUpdateChecker({
      currentVersion: '0.1.0',
      fetchImpl: async () => {
        if (kind === 'offline') throw new Error('network down');
        return response(release(kind === 'current' ? 'v0.1.0' : kind === 'ahead' ? 'v0.0.9' : 'v0.2.0'), kind === 'no-release' ? 404 : 200);
      },
      showMessageBox: async (options) => { dialogs.push(options); return { response: 1 }; },
      openExternal: async () => assert.fail(`unexpected download for ${kind}`),
    });
    const result = await checker.check();
    assert.equal(dialogs.length, 1);
    assert.equal(result.status, kind === 'cancel' ? 'available' : kind === 'offline' ? 'error' : kind);
    if (kind === 'offline') assert.equal(dialogs[0].type, 'error');
  }
});

test('a failed check releases the busy state so a later retry can succeed', async () => {
  let attempts = 0;
  const states = [];
  const checker = createUpdateChecker({
    currentVersion: '0.1.0',
    fetchImpl: async () => { if (++attempts === 1) throw new Error('offline'); return response(release('v0.1.0')); },
    onCheckingChange: (state) => states.push(state),
    showMessageBox: async () => ({ response: 0 }),
  });
  assert.equal((await checker.check()).status, 'error');
  assert.equal((await checker.check()).status, 'current');
  assert.deepEqual(states, [true, false, true, false]);
});
