import { stat } from 'node:fs/promises';
import path from 'node:path';

export const DISTRIBUTION_FILES = ['app.js', 'config.js', 'index.html', 'styles.css'];

export function resolveDistributionDirectory({ appRoot, resourcesPath } = {}) {
  if (typeof resourcesPath === 'string' && resourcesPath !== '') {
    return path.resolve(resourcesPath, 'web-dist');
  }
  return path.resolve(appRoot, '..', 'web', 'dist');
}

export async function verifyDistribution(directory) {
  if (typeof directory !== 'string' || directory === '') throw new Error('a distribution directory is required');
  const rootStats = await stat(directory).catch(() => null);
  if (!rootStats || !rootStats.isDirectory()) {
    throw new Error(`apps/web distribution not found: ${directory}\nRun "npm run build" in apps/web before starting the desktop app.`);
  }
  for (const name of DISTRIBUTION_FILES) {
    const entry = await stat(path.join(directory, name)).catch(() => null);
    if (!entry || !entry.isFile()) {
      throw new Error(`apps/web distribution is missing ${name}: ${directory}`);
    }
  }
  return directory;
}

export async function resolveVerifiedDistribution(options = {}) {
  return verifyDistribution(resolveDistributionDirectory(options));
}
