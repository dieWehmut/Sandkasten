import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ISOLATED_LANGUAGES,
  isolatedLanguageIds,
  isolatedLanguagesFrom,
  isolatedRunPlan,
  isolatedTools,
} from '../src/isolated-languages.mjs';

test('the isolated plan resolves a language to the command the main process owns', () => {
  assert.deepEqual(isolatedRunPlan('python'), { language: 'python', command: 'python3', args: ['{file}'] });
  assert.deepEqual(isolatedRunPlan('PYTHON'), { language: 'python', command: 'python3', args: ['{file}'] });
  assert.equal(isolatedRunPlan('cobol'), undefined);
  assert.equal(isolatedRunPlan(''), undefined);
});

test('compiled languages build and then run the artifact, because compiling alone succeeds silently', () => {
  for (const [language, compiler] of [['c', 'gcc'], ['cpp', 'g++']]) {
    const plan = isolatedRunPlan(language);
    assert.equal(plan.command, 'sh');
    assert.equal(plan.args[0], '-c');
    assert.ok(plan.args[1].includes(compiler), `${language} must name its compiler`);
    assert.ok(plan.args[1].includes('"$d/payload"'), `${language} must run the built payload`);
    assert.deepEqual(plan.args.slice(2), ['sandkasten', '{file}']);
    assert.deepEqual(ISOLATED_LANGUAGES[language].tools, ['sh', compiler]);
  }
});

test('the language list is one word per plan and never names TypeScript', () => {
  const ids = isolatedLanguageIds();
  assert.deepEqual(ids, ['python', 'javascript', 'c', 'cpp', 'java', 'bash', 'perl']);
  // The distro's node is not guaranteed to strip types, so the backend does not
  // claim TypeScript; the local runner and the sandbox API still run it.
  assert.equal(ids.includes('typescript'), false);
  for (const id of ids) assert.ok(isolatedRunPlan(id), `${id} must have a plan`);
});

test('availability needs every tool of the language, and reports each language', () => {
  assert.deepEqual(isolatedLanguagesFrom(['python3']), {
    python: true, javascript: false, c: false, cpp: false, java: false, bash: false, perl: false,
  });
  assert.deepEqual(isolatedLanguagesFrom(['sh', 'gcc', 'g++', 'node', 'java', 'bash', 'perl', 'python3']), {
    python: true, javascript: true, c: true, cpp: true, java: true, bash: true, perl: true,
  });
  assert.equal(isolatedLanguagesFrom(['sh']).c, false, 'a compiler without a shell still cannot build');
});

test('every tool the languages need is probed once', () => {
  const tools = isolatedTools();
  assert.equal(new Set(tools).size, tools.length, 'the probe list must not repeat a tool');
  assert.deepEqual(tools.slice().sort(), ['bash', 'g++', 'gcc', 'java', 'node', 'perl', 'python3', 'sh']);
});