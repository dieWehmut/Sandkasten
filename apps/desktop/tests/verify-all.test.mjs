import assert from 'node:assert/strict';
import test from 'node:test';

import { VERIFY_CHECKS, summarize } from '../scripts/verify-all.mjs';

test('the aggregate covers the shells, the local runtimes and the isolated backend', () => {
  assert.deepEqual(VERIFY_CHECKS.map((check) => check.script), ['verify-shells.mjs', 'verify-runtimes.mjs', 'verify-isolated.mjs']);
});

test('an absent backend counts as unavailable while a broken one counts as failed', () => {
  assert.deepEqual(
    summarize({ results: [{ status: 'ok' }, { status: 'unavailable' }, { status: 'failed' }] }),
    { ok: 1, unavailable: 1, failed: 1, unsupported: 0 },
  );
  assert.deepEqual(
    summarize({ results: [{ status: 'ok' }, { status: 'unsupported' }] }),
    { ok: 1, unavailable: 0, failed: 0, unsupported: 1 },
  );
  // The isolated backend reports availability outside its check list.
  assert.deepEqual(
    summarize({ detection: { available: false }, results: [] }),
    { ok: 0, unavailable: 1, failed: 0, unsupported: 0 },
  );
  assert.deepEqual(
    summarize({ detection: { available: true }, results: [{ status: 'ok' }, { status: 'failed' }] }),
    { ok: 1, unavailable: 0, failed: 1, unsupported: 0 },
  );
  assert.deepEqual(summarize(undefined), { ok: 0, unavailable: 0, failed: 0, unsupported: 0 });
});