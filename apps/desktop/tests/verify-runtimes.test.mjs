import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FAILURE_EXIT_CODE,
  RUNTIME_FAILURE_FIXTURES,
  RUNTIME_FIXTURES,
  runtimeFailureVerdict,
  runtimeVerdict,
} from '../scripts/verify-runtimes.mjs';

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

test('a runtime passes only on its own marker, and says why when it does not', () => {
  assert.deepEqual(runtimeVerdict({ status: 'JOB_STATUS_SUCCEEDED', stdout: 'SANDKASTEN_RUNTIME_OK:go\n' }, 'go'), { ok: true, reason: '' });

  // Running, but not the program that was asked for.
  assert.equal(runtimeVerdict({ status: 'JOB_STATUS_SUCCEEDED', stdout: 'hello\n' }, 'go').ok, false);
  // A failed run is not a pass, whatever it printed.
  assert.equal(runtimeVerdict({ status: 'JOB_STATUS_RUNTIME_FAILED', stdout: 'SANDKASTEN_RUNTIME_OK:go\n' }, 'go').ok, false);
  // The runner's own message is the reason when it has one.
  assert.match(runtimeVerdict({ status: 'JOB_STATUS_COMPILE_FAILED', stdout: '', errorMessage: 'Compilation failed' }, 'c').reason, /Compilation failed/);
});

test('a failing program passes only when its failure is reported with its code and words', () => {
  const good = { status: 'JOB_STATUS_RUNTIME_FAILED', exitCode: FAILURE_EXIT_CODE, stderr: 'SANDKASTEN_RUNTIME_FAILED:perl\n' };
  assert.equal(runtimeFailureVerdict(good, 'perl').ok, true);

  // The three ways a failure can be swallowed.
  const wrongStatus = runtimeFailureVerdict({ ...good, status: 'JOB_STATUS_SUCCEEDED' }, 'perl');
  assert.equal(wrongStatus.ok, false);
  assert.match(wrongStatus.reason, /got JOB_STATUS_SUCCEEDED/);
  assert.equal(runtimeFailureVerdict({ ...good, exitCode: 0 }, 'perl').ok, false);
  const silent = runtimeFailureVerdict({ ...good, stderr: 'boom\n' }, 'perl');
  assert.equal(silent.ok, false);
  assert.match(silent.reason, /without the program's stderr/);

  // A compiled language reports the failure on its compile stream too.
  const compileStream = { status: 'JOB_STATUS_RUNTIME_FAILED', exitCode: FAILURE_EXIT_CODE, stderr: '', compileStderr: 'SANDKASTEN_RUNTIME_FAILED:c\n' };
  assert.equal(runtimeFailureVerdict(compileStream, 'c').ok, true);
});