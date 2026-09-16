import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export function resolveApiBaseUrl(environment = process.env) {
  const value = environment.SANDKASTEN_API_BASE_URL;
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\/+$/, '');
}

function assertSafeApiBaseUrl(apiBaseUrl) {
  if (typeof apiBaseUrl !== 'string') throw new Error('an API base URL string is required');
  if (apiBaseUrl.includes('\n') || apiBaseUrl.includes('\r')) {
    throw new Error('the API base URL must not contain newline characters');
  }
}

// The web distribution is committed as the shared installer/Pages payload, so
// a desktop-only API origin is staged into one reusable scratch copy instead of
// rewriting the tracked files. An empty base URL keeps the bundled same-origin
// default and loads the distribution in place.
export async function prepareDistribution(sourceDirectory, { apiBaseUrl, stageRoot } = {}) {
  assertSafeApiBaseUrl(apiBaseUrl ?? '');
  if (!apiBaseUrl) return sourceDirectory;

  const stage = path.join(stageRoot, 'webui-runtime');
  await rm(stage, { recursive: true, force: true });
  await mkdir(stage, { recursive: true });
  await cp(sourceDirectory, stage, { recursive: true });
  await writeFile(
    path.join(stage, 'config.js'),
    `globalThis.SANDKASTEN_CONFIG = { apiBaseUrl: ${JSON.stringify(apiBaseUrl)} };\n`,
  );
  return stage;
}
