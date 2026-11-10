#!/usr/bin/env node
// Run against an installed debug APK and a real Sandkasten API + runner.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';

const serial = process.env.MOBILE_E2E_DEVICE ?? execFileSync('adb', ['devices'], { encoding: 'utf8' }).match(/^(emulator-\d+)\s+device$/m)?.[1];
assert.ok(serial?.startsWith('emulator-'), 'Select a running emulator with MOBILE_E2E_DEVICE');
const appId = 'dev.sandkasten.mobile';
const address = process.env.MOBILE_E2E_ADDRESS ?? 'http://10.0.2.2:8080';
const token = process.env.MOBILE_E2E_TOKEN ?? '';
const output = path.resolve(process.env.MOBILE_E2E_OUTPUT ?? '../../.sandkasten/mobile-native-e2e');
await mkdir(output, { recursive: true });
const adb = (...args) => execFileSync('adb', ['-s', serial, ...args], { encoding: 'utf8' });
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
async function until(test, description, timeout = 30000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await test()) return; await wait(100); }
  throw new Error(`Timed out: ${description}`);
}
let browser, page;
const errors = [], results = { serial, address, checks: [], screenshots: [] };
async function attach() {
  let socket;
  await until(async () => {
    socket = adb('shell', 'cat', '/proc/net/unix').match(/@(webview_devtools_remote[^\s]*)/)?.[1];
    return !!socket;
  }, 'WebView debugging socket');
  adb('forward', 'tcp:19222', `localabstract:${socket}`);
  // Android WebView cannot manage browser contexts or override downloads.
  browser = await chromium.connectOverCDP('http://127.0.0.1:19222', { noDefaults: true });
  await until(() => browser.contexts().some(context => context.pages().length), 'WebView page');
  page = browser.contexts().flatMap(context => context.pages())[0];
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForSelector('nav[aria-label="主导航"]');
  await until(() => page.evaluate(() => !document.querySelector('.launch-screen')), 'launch presentation');
  assert.equal(await page.evaluate(() => window.Capacitor.isNativePlatform()), true);
}
async function screenshot(name, target) {
  if (target) {
    await target.locator('.workbench-scroll').evaluate(element => { element.scrollTop = 0; });
    await target.scrollIntoViewIfNeeded();
  } else await page.evaluate(() => window.scrollTo(0, 0));
  await wait(150);
  const file = `${name}.png`;
  await writeFile(path.join(output, file), execFileSync('adb', ['-s', serial, 'exec-out', 'screencap', '-p']));
  results.screenshots.push(file);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `${name}: horizontal overflow`);
}
const nav = name => page.locator('nav[aria-label="主导航"]').getByRole('button', { name, exact: true }).click();
async function createProject(name, language, source, advanced = false, entrypoint = '') {
  await nav('项目');
  await page.getByRole('button', { name: '新建项目', exact: true }).click();
  await page.getByLabel('项目名称', { exact: true }).fill(name);
  await page.locator('.field-pair .picker-trigger').click();
  await page.getByRole('option').filter({ has: page.locator('.picker-option-label', { hasText: new RegExp(`^${language}$`) }) }).click();
  await until(() => page.locator('.picker-overlay[open]').count().then(count => count === 0), 'runtime picker closed');
  await page.getByLabel('源代码', { exact: true }).fill(source);
  if (advanced || entrypoint) await page.getByText('输入、参数与文件', { exact: true }).click();
  if (entrypoint) await page.getByLabel('入口文件', { exact: true }).fill(entrypoint);
  if (advanced) {
    await page.getByLabel('标准输入', { exact: true }).fill('mobile input\n');
    await page.getByLabel('运行参数（JSON 字符串数组）', { exact: true }).fill('["arg-value"]');
    await page.getByRole('button', { name: '添加文本文件', exact: true }).click();
    await page.getByLabel('附加文件名', { exact: true }).fill('data.txt');
    await page.getByLabel('文件内容', { exact: true }).fill('file-value');
  }
  await page.getByRole('button', { name: '保存项目', exact: true }).click();
  await until(() => page.locator('h1').innerText().then(text => text === '项目'), 'project saved');
  await page.locator('.project-grid article').filter({ has: page.getByRole('heading', { name, exact: true }) }).getByRole('button', { name: '打开运行栏' }).click();
  return page.locator('.workbench').filter({ has: page.getByRole('heading', { name, exact: true }) });
}
async function run(pane) {
  await pane.getByRole('button', { name: '运行', exact: true }).click();
  await until(() => pane.locator('.run-status').count().then(count => count === 1), 'job submission');
}
async function record(name, pane, expected) {
  await until(() => pane.locator('.run-status').innerText().then(status => status === expected), name, 60000);
  const id = (await pane.locator('.task-summary .project-path').innerText()).replace(/^任务\s*/, '');
  results.checks.push({ name, jobId: id, status: expected });
  return id;
}
try {
  adb('shell', 'am', 'force-stop', appId);
  adb('shell', 'am', 'start', '-n', `${appId}/.MainActivity`);
  await attach();
  await nav('控制台');
  await page.getByRole('button', { name: '连接电脑', exact: true }).click();
  await page.getByLabel('电脑 IP 或地址', { exact: true }).fill(address);
  await page.getByLabel('电脑名称', { exact: true }).fill('Android 验收电脑');
  await page.getByLabel('访问令牌', { exact: true }).fill(token);
  await page.getByRole('button', { name: '连接并保存', exact: true }).click();
  await until(() => page.locator('.connection-badge').filter({ hasText: '已连接' }).count().then(count => count > 0), 'real API connection');
  await screenshot('dashboard');
  const suffix = Date.now().toString(36);
  const pythonName = `Android Python ${suffix}`;
  let python = await createProject(pythonName, 'python', 'import sys\nprint(sys.stdin.read().strip()+"|"+sys.argv[1]+"|"+open("data.txt").read())\n', true);
  await run(python);
  await record('stdin, args and uploaded text file', python, '已完成');
  assert.ok((await python.locator('.source-output').innerText()).includes('mobile input|arg-value|file-value'));
  await screenshot('python-output', python);
  const go = await createProject(`Android Go ${suffix}`, 'go', 'package main\nfunc main(){ invalidsyntax }\n', false, 'tool.go');
  await run(go);
  await record('real compiler error', go, '编译失败');
  assert.ok((await go.locator('.source-output').innerText()).includes('invalidsyntax'), 'compiler reads the custom Go entrypoint');
  await screenshot('compiler-error', go);
  await python.getByRole('button', { name: '代码', exact: true }).click();
  await python.getByLabel('源代码', { exact: true }).fill('import time\nprint("before stop",flush=True)\ntime.sleep(25)\nprint("must not run")\n');
  await python.getByText('输入、参数与文件', { exact: true }).click();
  await python.getByLabel('运行超时（毫秒，0 使用电脑默认值）', { exact: true }).fill('30000');
  await run(python);
  await until(() => python.locator('.run-status').innerText().then(status => status === '运行中'), 'running process');
  // RUNNING is committed before exec begins. Give the test program time to
  // emit its flushed marker before requesting cancellation.
  await wait(1000);
  await screenshot('before-stop', python);
  await python.getByRole('button', { name: '停止任务', exact: true }).click();
  await record('stop a real running process', python, '已停止');
  await until(() => python.locator('.source-output').allTextContents().then(items => items.join('').includes('before stop')), 'final canceled output');
  assert.ok(!(await python.locator('.source-output').allTextContents()).join('').includes('must not run'));
  await screenshot('stopped-output', python);
  for (const theme of ['珊瑚', '玫瑰', '海盐', '森林', '靛蓝', '琥珀']) {
    await nav('设置');
    await page.locator('.list-row').filter({ hasText: '选择你的配色' }).click();
    await page.locator('.theme-option').filter({ hasText: theme }).click();
    await screenshot(`theme-${theme}`);
    adb('shell', 'input', 'keyevent', '4');
    await until(() => page.locator('h1').innerText().then(text => text === '设置'), 'system back from theme');
    await screenshot(`settings-${theme}`);
    await nav('项目'); await screenshot(`projects-${theme}`);
    await nav('任务'); await screenshot(`tasks-${theme}`, python);
    await nav('控制台'); await screenshot(`dashboard-${theme}`);
  }
  await nav('设置');
  await page.getByRole('button', { name: '单栏', exact: true }).click();
  await nav('任务');
  await screenshot('single-column');
  await nav('设置');
  await page.locator('.list-row').filter({ hasText: '选择你的配色' }).click();
  await page.locator('.theme-option').filter({ hasText: '珊瑚' }).click();
  adb('shell', 'input', 'keyevent', '4');
  await until(() => page.locator('h1').innerText().then(text => text === '设置'), 'return to settings');
  const before = await page.evaluate(() => localStorage.getItem('sandkasten.panels'));
  await browser.close(); browser = null;
  adb('shell', 'am', 'force-stop', appId);
  adb('shell', 'am', 'start', '-n', `${appId}/.MainActivity`);
  await attach();
  await until(() => page.locator('.connection-badge').filter({ hasText: '已连接' }).count().then(count => count > 0), 'Keystore automatic reconnect');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'coral');
  assert.equal(await page.evaluate(() => localStorage.getItem('sandkasten.panels')), before);
  await nav('任务');
  assert.equal(await page.locator('.workbench-grid').getAttribute('data-columns'), '1');
  assert.ok(await page.getByRole('heading', { name: pythonName, exact: true }).count());
  python = page.locator('.workbench').filter({ has: page.getByRole('heading', { name: pythonName, exact: true }) });
  await python.getByRole('button', { name: '输出', exact: true }).click();
  await until(() => python.locator('.source-output').allTextContents().then(items => items.join('').includes('before stop')), 'output restored from real API');
  await screenshot('restored-after-force-stop', python);
  results.checks.push({ name: 'Keystore, panel, theme, column and output restoration', status: 'passed' });
  assert.deepEqual(errors, [], 'WebView page errors');
  results.passed = true;
  console.log(`Native E2E passed: ${results.checks.length} checks; ${results.screenshots.length} screenshots; ${output}`);
} catch (error) {
  results.passed = false; results.failure = error.stack;
  if (page) await screenshot('failure').catch(() => {});
  throw error;
} finally {
  results.errors = errors;
  await writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
  if (browser) await browser.close();
  adb('forward', '--remove', 'tcp:19222');
}
