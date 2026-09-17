// Minimal GitHub Releases client for publishing the desktop installer. It uses
// the REST API directly so no extra tooling (such as the gh CLI) is required on
// the release host.
import { createReadStream, statSync } from 'node:fs';
import path from 'node:path';

export const GITHUB_API = 'https://api.github.com';

export function releaseApiUrl(repo, suffix = '') {
  if (typeof repo !== 'string' || !/^[^/\s]+\/[^/\s]+$/.test(repo)) {
    throw new Error(`invalid repository: ${repo}`);
  }
  return `${GITHUB_API}/repos/${repo}/releases${suffix}`;
}

export function buildReleaseHeaders(token) {
  if (typeof token !== 'string' || token.trim() === '') throw new Error('a token is required');
  return {
    Authorization: `Bearer ${token.trim()}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'sandkasten-desktop-release',
  };
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`GitHub returned invalid JSON (${response.status})`);
  }
}

async function request({ fetchImpl, token, url, method = 'GET', body, headers }) {
  const response = await fetchImpl(url, {
    method,
    headers: { ...buildReleaseHeaders(token), ...(headers ?? {}) },
    body,
  });
  const payload = await readJson(response);
  if (!response.ok) {
    throw new Error(`GitHub ${method} ${url} failed (${response.status}): ${payload.message ?? 'unknown error'}`);
  }
  return payload;
}

export async function findReleaseByTag({ repo, tag, token, fetchImpl = fetch }) {
  const response = await fetchImpl(releaseApiUrl(repo, `/tags/${encodeURIComponent(tag)}`), {
    headers: buildReleaseHeaders(token),
  });
  if (response.status === 404) return null;
  const payload = await readJson(response);
  if (!response.ok) throw new Error(`GitHub release lookup failed (${response.status}): ${payload.message ?? 'unknown error'}`);
  return payload;
}

export async function createRelease({ repo, tag, name, body = '', token, fetchImpl = fetch }) {
  return request({
    fetchImpl,
    token,
    url: releaseApiUrl(repo),
    method: 'POST',
    body: JSON.stringify({ tag_name: tag, name, body, draft: false, prerelease: false }),
  });
}

export async function uploadReleaseAsset({ repo, release, file, token, fetchImpl = fetch, contentType = 'application/octet-stream' }) {
  const stats = statSync(file, { throwIfNoEntry: false });
  if (!stats?.isFile()) throw new Error(`missing release asset: ${file}`);

  const uploadUrl = release.upload_url?.replace(/\{[^}]*\}$/, '');
  if (typeof uploadUrl !== 'string' || uploadUrl === '') throw new Error(`release ${release.id} has no upload URL`);
  const name = path.basename(file);

  // Uploading an existing asset name fails, so replace any previous upload.
  const existing = (release.assets ?? []).find((asset) => asset.name === name);
  if (existing) {
    await request({ fetchImpl, token, url: `${GITHUB_API}/repos/${repo}/releases/assets/${existing.id}`, method: 'DELETE' });
  }

  // Uploads use the raw upload endpoint rather than the JSON API, so the body is
  // streamed straight from disk.
  const response = await fetchImpl(`${uploadUrl}?name=${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { ...buildReleaseHeaders(token), 'Content-Type': contentType, 'Content-Length': String(stats.size) },
    body: createReadStream(file),
    duplex: 'half',
  });
  const payload = await readJson(response);
  if (!response.ok) throw new Error(`GitHub asset upload failed (${response.status}): ${payload.message ?? 'unknown error'}`);
  return payload;
}
