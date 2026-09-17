import assert from 'node:assert/strict';
import test from 'node:test';

import {
  GITHUB_API,
  buildReleaseHeaders,
  createRelease,
  findReleaseByTag,
  releaseApiUrl,
  updateRelease,
} from '../src/github-release.mjs';

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  };
}

test('builds release endpoints from the repository slug', () => {
  assert.equal(releaseApiUrl('dieWehmut/Sandkasten'), `${GITHUB_API}/repos/dieWehmut/Sandkasten/releases`);
  assert.equal(releaseApiUrl('dieWehmut/Sandkasten', '/tags/v0.1.0'), `${GITHUB_API}/repos/dieWehmut/Sandkasten/releases/tags/v0.1.0`);
  assert.throws(() => releaseApiUrl('not-a-slug'), /invalid repository/);
  assert.throws(() => releaseApiUrl(undefined), /invalid repository/);
});

test('sends an authenticated, versioned user agent without leaking the token elsewhere', () => {
  const headers = buildReleaseHeaders('secret-token');
  assert.equal(headers.Authorization, 'Bearer secret-token');
  assert.equal(headers['X-GitHub-Api-Version'], '2022-11-28');
  assert.equal(headers['User-Agent'], 'sandkasten-desktop-release');
  assert.throws(() => buildReleaseHeaders('  '), /token is required/);
});

test('treats a missing release as absent instead of an error', async () => {
  const calls = [];
  const release = await findReleaseByTag({
    repo: 'dieWehmut/Sandkasten',
    tag: 'v0.1.0',
    token: 't',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse({ message: 'Not Found' }, 404);
    },
  });
  assert.equal(release, null);
  assert.equal(calls[0].url, `${GITHUB_API}/repos/dieWehmut/Sandkasten/releases/tags/v0.1.0`);
});

test('returns an existing release for its tag', async () => {
  const release = await findReleaseByTag({
    repo: 'dieWehmut/Sandkasten',
    tag: 'v0.1.0',
    token: 't',
    fetchImpl: async () => jsonResponse({ id: 7, tag_name: 'v0.1.0', upload_url: 'https://uploads.example.com/7{?name,label}' }),
  });
  assert.equal(release.id, 7);
});

test('creates a published release with the requested tag', async () => {
  let captured;
  const release = await createRelease({
    repo: 'dieWehmut/Sandkasten',
    tag: 'v0.1.0',
    name: 'Sandkasten 0.1.0',
    body: 'notes',
    token: 't',
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return jsonResponse({ id: 1, tag_name: 'v0.1.0' }, 201);
    },
  });
  assert.equal(release.tag_name, 'v0.1.0');
  assert.equal(captured.options.method, 'POST');
  assert.deepEqual(JSON.parse(captured.options.body), {
    tag_name: 'v0.1.0',
    name: 'Sandkasten 0.1.0',
    body: 'notes',
    draft: false,
    prerelease: false,
  });
});

test('surfaces GitHub errors with their message', async () => {
  await assert.rejects(
    () => createRelease({ repo: 'dieWehmut/Sandkasten', tag: 'v1', name: 'n', token: 't', fetchImpl: async () => jsonResponse({ message: 'Validation Failed' }, 422) }),
    /Validation Failed/,
  );
});

test('refreshes an existing release instead of keeping stale metadata', async () => {
  let captured;
  const release = await updateRelease({
    repo: 'dieWehmut/Sandkasten',
    release: { id: 7 },
    tag: 'v0.1.0',
    name: 'Sandkasten 0.1.0',
    body: 'fresh notes',
    token: 't',
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return jsonResponse({ id: 7, tag_name: 'v0.1.0', body: 'fresh notes' });
    },
  });
  assert.equal(release.body, 'fresh notes');
  assert.equal(captured.url, `${GITHUB_API}/repos/dieWehmut/Sandkasten/releases/7`);
  assert.equal(captured.options.method, 'PATCH');
  await assert.rejects(
    () => updateRelease({ repo: 'dieWehmut/Sandkasten', tag: 'v1', name: 'n', token: 't' }),
    /existing release/,
  );
});
