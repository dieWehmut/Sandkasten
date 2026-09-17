import assert from 'node:assert/strict';
import test from 'node:test';

import {
  REQUIRED_INSTALLER_ENTRIES,
  SEVEN_ZIP_SIGNATURE,
  findPayloadOffsets,
  inspectInstallerPayloads,
  parseSevenZipListing,
} from '../src/installer-payload.mjs';

function listing(entries, archive = 'C:\\build\\Sandkasten-0.1.0-Setup.exe') {
  const lines = ['Path = ' + archive, 'Type = 7z', 'Method = LZMA2:20'];
  for (const [name, method] of entries) lines.push('Path = ' + name, 'Method = ' + method);
  return lines.join('\n');
}

const completeEntries = [
  ['Sandkasten.exe', 'BCJ LZMA2:20'],
  ['ffmpeg.dll', 'BCJ LZMA2:20'],
  ['resources\\app.asar', 'BCJ LZMA2:20'],
  ['resources\\web-dist\\index.html', 'BCJ LZMA2:20'],
];

test('locates every embedded payload in an installer image', () => {
  const buffer = Buffer.concat([
    Buffer.alloc(16, 0xaa),
    SEVEN_ZIP_SIGNATURE,
    Buffer.alloc(32, 0xbb),
    SEVEN_ZIP_SIGNATURE,
    Buffer.alloc(8, 0xcc),
  ]);
  assert.deepEqual(findPayloadOffsets(buffer), [16, 54]);
  assert.deepEqual(findPayloadOffsets(Buffer.alloc(8)), []);
});

test('skips the archive header and keeps one entry per file', () => {
  const entries = parseSevenZipListing(listing(completeEntries), 'C:\\build\\Sandkasten-0.1.0-Setup.exe');
  assert.deepEqual(entries.map((entry) => entry.name), completeEntries.map(([name]) => name));
  assert.equal(entries[0].method, 'BCJ LZMA2:20');
});

test('accepts a payload the bundled nsis7z plugin can decode', () => {
  const entries = parseSevenZipListing(listing(completeEntries), 'C:\\build\\Sandkasten-0.1.0-Setup.exe');
  assert.deepEqual(inspectInstallerPayloads([entries]), { payloads: 1, problems: [] });
});

test('rejects ARM64-filtered entries the bundled plugin would silently skip', () => {
  const broken = [
    ['Sandkasten.exe', 'ARM64 LZMA2:20'],
    ['ffmpeg.dll', 'ARM64 LZMA2:20'],
    ['resources\\app.asar', 'BCJ LZMA2:20'],
    ['resources\\web-dist\\index.html', 'BCJ LZMA2:20'],
  ];
  const entries = parseSevenZipListing(listing(broken), 'C:\\build\\Sandkasten-0.1.0-Setup.exe');
  const { problems } = inspectInstallerPayloads([entries]);
  assert.equal(problems.length, 1);
  assert.equal(problems[0].kind, 'undecodable');
  assert.deepEqual(problems[0].names, ['Sandkasten.exe', 'ffmpeg.dll']);
});

test('rejects payloads that dropped a required entry', () => {
  const entries = parseSevenZipListing(
    listing(completeEntries.filter(([name]) => name !== 'Sandkasten.exe')),
    'C:\\build\\Sandkasten-0.1.0-Setup.exe',
  );
  const { problems } = inspectInstallerPayloads([entries]);
  assert.equal(problems.length, 1);
  assert.equal(problems[0].kind, 'missing');
  assert.deepEqual(problems[0].names, ['Sandkasten.exe']);
  assert.ok(REQUIRED_INSTALLER_ENTRIES.includes('resources\\web-dist\\index.html'));
});

test('reports problems per payload', () => {
  const good = parseSevenZipListing(listing(completeEntries), 'C:\\build\\good.exe');
  const broken = parseSevenZipListing(
    listing([['Sandkasten.exe', 'ARM64 LZMA2:20'], ...completeEntries.slice(1)], 'C:\\build\\broken.exe'),
    'C:\\build\\broken.exe',
  );
  const { payloads, problems } = inspectInstallerPayloads([broken, good]);
  assert.equal(payloads, 2);
  assert.equal(problems.length, 1);
  assert.equal(problems[0].index, 0);
});
