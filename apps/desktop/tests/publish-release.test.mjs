import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { planRelease, resolveNotes } from '../scripts/publish-release.mjs';

test('derives the tag, title, and asset path from the desktop version', () => {
  const plan = planRelease({ version: '0.1.0', repositoryRoot: path.resolve('/srv/sandkasten') });
  assert.equal(plan.tag, 'v0.1.0');
  assert.equal(plan.name, 'Sandkasten 0.1.0');
  assert.deepEqual(plan.files, [path.join(path.resolve('/srv/sandkasten'), 'tmp', 'desktop-dist', 'Sandkasten-0.1.0-Setup.exe')]);
});

test('prefers a notes file so multiline notes survive shell quoting', () => {
  const readFile = (file) => {
    assert.equal(file, '/tmp/notes.md');
    return 'line one\nline two\n';
  };
  assert.equal(resolveNotes({ notes: 'inline', notesFile: '/tmp/notes.md' }, { readFile }), 'line one\nline two\n');
  assert.equal(resolveNotes({ notes: 'inline' }, { readFile }), 'inline');
  assert.equal(resolveNotes({}, { readFile }), '');
});
