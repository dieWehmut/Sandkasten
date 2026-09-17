#!/usr/bin/env node
// Publish the packaged desktop installer as a GitHub release asset. The script
// builds nothing: it uploads the artifacts produced by "npm run package:win"
// after "npm run verify:installer" confirmed the payload is complete, so a
// broken installer can never become a downloadable release.
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createRelease, findReleaseByTag, updateRelease, uploadReleaseAsset } from '../src/github-release.mjs';
import { verifyPayloadsFromFile } from '../src/installer-payload.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function parseArgs(argv) {
  const options = { repo: 'dieWehmut/Sandkasten', tag: null, name: null, files: [], notes: null, dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--repo') options.repo = argv[++index];
    else if (arg === '--tag') options.tag = argv[++index];
    else if (arg === '--name') options.name = argv[++index];
    else if (arg === '--notes') options.notes = argv[++index];
    else if (arg === '--file') options.files.push(argv[++index]);
    else if (arg === '--dry-run') options.dryRun = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

function resolveToken(environment = process.env) {
  const token = environment.GH_TOKEN || environment.GITHUB_TOKEN;
  if (typeof token !== 'string' || token.trim() === '') {
    throw new Error('set GH_TOKEN or GITHUB_TOKEN to a token with repo scope');
  }
  return token.trim();
}

export function planRelease({ version, repositoryRoot: root = repositoryRoot }) {
  const installer = path.join(root, 'tmp', 'desktop-dist', `Sandkasten-${version}-Setup.exe`);
  return { tag: `v${version}`, name: `Sandkasten ${version}`, files: [installer] };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const pkg = JSON.parse(readFileSync(path.join(repositoryRoot, 'apps', 'desktop', 'package.json'), 'utf8'));
  const plan = planRelease({ version: pkg.version, repositoryRoot });
  const tag = options.tag ?? plan.tag;
  const name = options.name ?? plan.name;
  const files = options.files.length > 0 ? options.files.map((file) => path.resolve(file)) : plan.files;

  for (const file of files) {
    const stats = statSync(file, { throwIfNoEntry: false });
    if (!stats?.isFile()) throw new Error(`missing release asset: ${file}`);
    verifyPayloadsFromFile(file);
    process.stdout.write(`verified payload: ${path.basename(file)}\n`);
  }

  if (options.dryRun) {
    process.stdout.write(`dry run: ${options.repo} tag=${tag} name=${name}\n`);
    for (const file of files) process.stdout.write(`  asset ${path.basename(file)}\n`);
    return;
  }

  const token = resolveToken();
  const request = { token, fetchImpl: fetch };
  const existing = await findReleaseByTag({ ...request, repo: options.repo, tag });
  const notes = options.notes ?? '';
  // A release is immutable through createRelease once it exists, so re-runs
  // refresh the title and notes instead of silently keeping stale metadata.
  const release = existing
    ? await updateRelease({ ...request, repo: options.repo, release: existing, tag, name, body: notes })
    : await createRelease({ ...request, repo: options.repo, tag, name, body: notes });
  process.stdout.write(`${existing ? 'updated' : 'created'} release ${release.tag_name ?? tag}\n`);

  for (const file of files) {
    const asset = await uploadReleaseAsset({ ...request, repo: options.repo, release, file });
    process.stdout.write(`uploaded ${asset.name} (${asset.size} bytes)\n`);
  }
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  main().catch((error) => {
    process.stderr.write(`publish-release: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
