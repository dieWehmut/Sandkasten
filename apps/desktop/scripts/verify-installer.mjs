#!/usr/bin/env node
// Inspect a built NSIS installer and fail when its embedded payload would not
// install completely. The nsis7z plugin ships an older 7-Zip than the build
// tooling, so a payload entry compressed with a filter the plugin cannot decode
// is skipped silently at install time: the app lands without its executable.
// Listing the payload with the same 7-Zip build that produced it catches that
// regression before the artifact is published.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getPath7za } from 'app-builder-lib/out/toolsets/7zip.js';

import {
  findPayloadOffsets,
  inspectInstallerPayloads,
  parseSevenZipListing,
} from '../src/installer-payload.mjs';

// Resolve the default artifact from the repository root so the script works
// from apps/desktop (npm script) and from the repository root alike.
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function listEntries(sevenZip, archive) {
  const result = spawnSync(sevenZip, ['l', '-slt', archive], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`7za failed for ${archive}: ${result.stderr || result.stdout}`);
  return parseSevenZipListing(result.stdout, archive);
}

async function main() {
  const installer = path.resolve(
    process.argv[2] ?? path.join(repositoryRoot, 'tmp', 'desktop-dist', 'Sandkasten-0.1.0-Setup.exe'),
  );
  const stats = statSync(installer, { throwIfNoEntry: false });
  if (!stats?.isFile()) {
    process.stderr.write(`verify-installer: missing installer: ${installer}\n`);
    process.exitCode = 1;
    return;
  }

  const sevenZip = await getPath7za();
  const buffer = readFileSync(installer);
  const offsets = findPayloadOffsets(buffer);
  if (offsets.length === 0) {
    process.stderr.write(`verify-installer: no embedded 7z payload in ${installer}\n`);
    process.exitCode = 1;
    return;
  }

  const work = mkdtempSync(path.join(tmpdir(), 'sandkasten-installer-'));
  const payloads = [];
  try {
    offsets.forEach((offset, index) => {
      const payload = path.join(work, `payload-${index}.7z`);
      writeFileSync(payload, buffer.subarray(offset));
      payloads.push(listEntries(sevenZip, payload));
    });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }

  const { problems } = inspectInstallerPayloads(payloads);
  payloads.forEach((entries, index) => {
    const count = problems.filter((problem) => problem.index === index).length;
    process.stdout.write(`payload ${index}: entries=${entries.length} problems=${count}\n`);
  });
  for (const problem of problems) {
    process.stderr.write(`  payload ${problem.index} ${problem.kind}: ${problem.names.join(', ')}\n`);
  }

  if (problems.length > 0) {
    process.stderr.write(`verify-installer: ${problems.length} problem(s) in ${installer}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`verify-installer: ok (${payloads.length} payload(s))\n`);
}

main().catch((error) => {
  process.stderr.write(`verify-installer: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
