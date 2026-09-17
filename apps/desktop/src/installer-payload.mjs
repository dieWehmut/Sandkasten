// Shared parsing for the NSIS installer payload check. The build tooling ships
// a 7-Zip newer than the nsis7z plugin inside the installer, so an entry the
// plugin cannot decode is dropped silently during installation. The check
// therefore inspects the embedded payload and rejects filters the plugin
// predates.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const SEVEN_ZIP_SIGNATURE = Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]);

// The ARM64 branch-converter filter arrived in 7-Zip 23; nsis7z predates it.
export const UNDECODABLE_FILTER = /arm64/i;

export const REQUIRED_INSTALLER_ENTRIES = [
  'Sandkasten.exe',
  'resources\\app.asar',
  'resources\\web-dist\\index.html',
];

export function findPayloadOffsets(buffer) {
  const offsets = [];
  let index = 0;
  while ((index = buffer.indexOf(SEVEN_ZIP_SIGNATURE, index)) !== -1) {
    offsets.push(index);
    index += 1;
  }
  return offsets;
}

export function parseSevenZipListing(output, archivePath) {
  const entries = [];
  let current = null;
  for (const line of String(output).split(/\r?\n/)) {
    if (line.startsWith('Path = ')) {
      const value = line.slice(7);
      // The listing opens with the archive itself; only the file entries that
      // follow carry a compression method.
      current = value === archivePath ? null : value;
    } else if (line.startsWith('Method = ') && current !== null) {
      entries.push({ name: current, method: line.slice(9) });
      current = null;
    }
  }
  return entries;
}

export function inspectInstallerPayloads(payloads) {
  const problems = [];
  payloads.forEach((entries, index) => {
    const undecodable = entries.filter((entry) => UNDECODABLE_FILTER.test(entry.method));
    const names = entries.map((entry) => entry.name);
    const missing = REQUIRED_INSTALLER_ENTRIES.filter((required) => !names.includes(required));
    if (undecodable.length > 0) {
      problems.push({ index, kind: 'undecodable', names: undecodable.map((entry) => entry.name) });
    }
    if (missing.length > 0) problems.push({ index, kind: 'missing', names: missing });
  });
  return { payloads: payloads.length, problems };
}

// Read a built installer, list every embedded payload with the 7-Zip build that
// produced it, and report undecodable or missing entries.
export async function inspectInstallerFile(installer, { sevenZip, listEntries } = {}) {
  if (typeof sevenZip !== 'string' || typeof listEntries !== 'function') {
    throw new Error('sevenZip and listEntries are required');
  }
  const buffer = readFileSync(installer);
  const offsets = findPayloadOffsets(buffer);
  if (offsets.length === 0) throw new Error(`no embedded 7z payload in ${installer}`);

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
  return { entriesByPayload: payloads, ...inspectInstallerPayloads(payloads) };
}

export async function verifyPayloadsFromFile(installer, { sevenZip, listEntries } = {}) {
  if (typeof sevenZip === 'string' && typeof listEntries === 'function') {
    const result = await inspectInstallerFile(installer, { sevenZip, listEntries });
    assertComplete(result, installer);
    return result;
  }
  const { spawnSync } = await import('node:child_process');
  const { getPath7za } = await import('app-builder-lib/out/toolsets/7zip.js');
  const resolved = await getPath7za();
  const list = (binary, archive) => {
    const listed = spawnSync(binary, ['l', '-slt', archive], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    if (listed.status !== 0) throw new Error(`7za failed for ${archive}: ${listed.stderr || listed.stdout}`);
    return parseSevenZipListing(listed.stdout, archive);
  };
  const result = await inspectInstallerFile(installer, { sevenZip: resolved, listEntries: list });
  assertComplete(result, installer);
  return result;
}

function assertComplete(result, installer) {
  if (result.problems.length === 0) return;
  const detail = result.problems.map((problem) => `payload ${problem.index} ${problem.kind}: ${problem.names.join(', ')}`);
  throw new Error(`installer payload is incomplete: ${detail.join('; ')} (${installer})`);
}
