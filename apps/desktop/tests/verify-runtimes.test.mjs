import assert from 'node:assert/strict';
import test from 'node:test';

import { FAILURE_EXIT_CODE, RUNTIME_FAILURE_FIXTURES, RUNTIME_FIXTURES } from '../scripts/verify-runtimes.mjs';

test('every runtime the check can run has a failure fixture as well', () => {
  // A language added to the success fixtures without one here would silently skip
  // the half of the check that proves failures are reported.
  const missing = Object.keys(RUNTIME_FIXTURES).filter((language) => !RUNTIME_FAILURE_FIXTURES[language]);
  assert.deepEqual(missing, []);
  assert.deepEqual(Object.keys(RUNTIME_FAILURE_FIXTURES).sort(), Object.keys(RUNTIME_FIXTURES).sort());
});

test('each failure fixture exits with the code the check expects and writes its marker there', () => {
  for (const [language, fixture] of Object.entries(RUNTIME_FAILURE_FIXTURES)) {
    assert.ok(fixture.file.length > 0, `${language} needs a file name`);
    assert.ok(fixture.source.includes(`SANDKASTEN_RUNTIME_FAILED:${language}`),
      `${language} has to print its own marker`);
    assert.ok(fixture.source.includes(String(FAILURE_EXIT_CODE)), `${language} has to exit with ${FAILURE_EXIT_CODE}`);
  }
  // Java runs a class, so the file has to match the class it declares.
  assert.match(RUNTIME_FAILURE_FIXTURES.java.source, /public class Fail/);
  assert.equal(RUNTIME_FAILURE_FIXTURES.java.file, 'Fail.java');
});