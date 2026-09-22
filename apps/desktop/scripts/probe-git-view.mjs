#!/usr/bin/env node
// Drive the real desktop shell to the Source Control view and the editor, then
// capture them. This is a visual check of what the reference shows.
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const appRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname.slice(1)), '..');
const repositoryRoot = path.resolve(appRoot, '..', '..');
const outputRoot = path.join(repositoryRoot, 'tmp', 'git-view-probe');
await mkdir(outputRoot, { recursive: true });

async function loadElectronDriver() {
  const candidates = [
    path.join(appRoot, '..', 'web', 'node_modules', 'playwright-core', 'index.js'),
    path.join(appRoot, 'node_modules', 'playwright-core', 'index.js'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      const module = await import(pathToFileURL(candidate).href);
      return module._electron ?? module.default?._electron ?? module.default;
    }
  }
  throw new Error('playwright-core is required for the git probe');
}
const electron = await loadElectronDriver();

const workspace = await mkdtemp(path.join(os.tmpdir(), 'sandkasten-git-'));
await mkdir(path.join(workspace, 'src', 'data'), { recursive: true });
await writeFile(path.join(workspace, 'src', 'data', 'generated.ts'), 'export const rows = [1, 2, 3];' + String.fromCharCode(10));
await writeFile(path.join(workspace, 'src', 'data', 'yjango.md'), '# yjango' + String.fromCharCode(10));
await writeFile(path.join(workspace, 'main.py'), 'def greet(name):' + String.fromCharCode(10) + '    print(f"hello {name}")' + String.fromCharCode(10) + String.fromCharCode(10) + 'greet("world")' + String.fromCharCode(10));
// `-c` takes one `name=value` argument; splitting the pair makes git read the
// name as the command and the commit fails, leaving an empty view.
const git = (...args) => spawnSync('git', ['-c', 'user.email=probe@sandkasten.local', '-c', 'user.name=Probe', ...args], { cwd: workspace, stdio: 'ignore' });
git('init', '--initial-branch=main');
git('add', '.');
git('commit', '-m', 'feat: seed the probe workspace');
await writeFile(path.join(workspace, 'src', 'data', 'first.ts'), 'export const first = 1;' + String.fromCharCode(10));
git('add', '.');
git('commit', '-m', 'fix(pdf): anchor contents end to end');
git('checkout', '-b', 'topic');
await writeFile(path.join(workspace, 'src', 'data', 'topic.ts'), 'export const topic = 2;' + String.fromCharCode(10));
git('add', '.');
git('commit', '-m', 'docs(template): name the entrypoint');
git('checkout', 'main');
await writeFile(path.join(workspace, 'src', 'data', 'second.ts'), 'export const second = 3;' + String.fromCharCode(10));
git('add', '.');
git('commit', '-m', 'test: support Windows line endings');
await writeFile(path.join(workspace, 'src', 'data', 'generated.ts'), 'export const rows = [1, 2, 3, 4];' + String.fromCharCode(10));
await writeFile(path.join(workspace, 'src', 'data', 'yjango.md'), '# yjango updated' + String.fromCharCode(10));

const executable = process.env.SANDKASTEN_E2E_EXECUTABLE;
const electronExecutable = executable
  ?? (await import(pathToFileURL(path.join(appRoot, 'node_modules', 'electron', 'index.js')).href)).default;
const profileArgument = '--user-data-dir=' + path.join(workspace, '..', 'profile');
const app = await electron.launch({
  executablePath: electronExecutable,
  args: executable ? [profileArgument] : [appRoot, profileArgument],
  env: { ...process.env, SANDKASTEN_WORKSPACE_ROOT: workspace, SANDKASTEN_E2E_PROBE: '1' },
  cwd: appRoot,
});
const page = await app.firstWindow();
await page.waitForSelector('[data-testid="app-shell"]', { timeout: 30000 });
if (await page.locator('[data-testid="setup-dismiss"]').count()) await page.click('[data-testid="setup-dismiss"]');
await page.waitForSelector('[data-testid="workbench-shell"]', { timeout: 30000 });

const report = { workspace };
// The editor first: the source must render with colored tokens.
await page.waitForSelector('[data-path="main.py"]', { timeout: 15000 });
await page.click('[data-path="main.py"] .ide-tree__open');
await page.waitForSelector('.cm-content', { timeout: 15000 });
await page.waitForTimeout(600);
report.editorTokens = await page.evaluate(() => Array.from(document.querySelectorAll('.cm-content .cm-line span'))
  .slice(0, 14)
  .map((span) => ({ text: span.textContent.slice(0, 24), color: getComputedStyle(span).color }))
  .filter((entry, index, all) => entry.color !== 'rgb(0, 0, 0)' || index < 3));
await page.screenshot({ path: path.join(outputRoot, 'editor-light.png') });

// Then the source control view.
await page.click('[data-activity="source-control"]');
await page.waitForSelector('[data-testid="source-control"]', { timeout: 15000 });
await page.waitForTimeout(1200);
report.sourceControl = await page.evaluate(() => ({
  branch: document.querySelector('[data-testid="source-control-branch"]')?.textContent?.trim() ?? null,
  changes: Array.from(document.querySelectorAll('[data-change]')).map((n) => n.getAttribute('data-change')),
  history: Array.from(document.querySelectorAll('[data-commit]')).map((n) => n.getAttribute('data-commit')),
  hasGraph: Boolean(document.querySelector('[data-testid="source-control-graph"]')),
  rowStyles: Array.from(document.querySelectorAll('[data-commit]')).slice(0, 2).map((node) => {
    const subject = node.querySelector('.ide-source-control__commit-subject');
    const author = node.querySelector('.ide-source-control__commit-author');
    const entry = getComputedStyle(node);
    return {
      entryDisplay: entry.display,
      entryWhiteSpace: entry.whiteSpace,
      subjectText: subject?.textContent ?? null,
      subjectDisplay: subject ? getComputedStyle(subject).display : null,
      subjectFlex: subject ? getComputedStyle(subject).flex : null,
      subjectMinWidth: subject ? getComputedStyle(subject).minWidth : null,
      subjectWhiteSpace: subject ? getComputedStyle(subject).whiteSpace : null,
      subjectOverflow: subject ? getComputedStyle(subject).overflow : null,
      authorColor: author ? getComputedStyle(author).color : null,
      svgDisplay: getComputedStyle(node.querySelector('svg')).display,
      listStyle: getComputedStyle(node.parentElement).listStyleType,
      sidebarWidth: node.closest('[data-testid="source-control"]')?.getBoundingClientRect().width ?? null,
    };
  }),
  graphColumns: Array.from(document.querySelectorAll('[data-commit]')).map((node) => ({
    commit: node.getAttribute('data-commit'),
    column: Number(node.getAttribute('data-column')),
    head: node.getAttribute('data-head'),
    refs: Array.from(node.querySelectorAll('[data-ref]')).map((ref) => ref.getAttribute('data-ref')),
  })),
  actionButtons: Array.from(document.querySelectorAll('.ide-source-control button[data-action]')).map((b) => b.getAttribute('data-action')),
}));
await page.screenshot({ path: path.join(outputRoot, 'source-control-light.png') });

// The reference is a dark screenshot, so the same view is captured in dark
// mode and the rail colours are read back to prove they are not lost there.
await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
await page.waitForTimeout(400);
report.darkRails = await page.evaluate(() => {
  const dot = document.querySelector('.ide-source-control__graph-dot');
  const line = document.querySelector('.ide-source-control__graph-line');
  const surface = document.querySelector('[data-testid="source-control"]');
  return {
    scheme: document.documentElement.dataset.theme ?? null,
    dotFill: dot ? getComputedStyle(dot).fill : null,
    lineStroke: line ? getComputedStyle(line).stroke : null,
    surface: surface ? getComputedStyle(surface).backgroundColor : null,
  };
});
await page.screenshot({ path: path.join(outputRoot, 'source-control-dark.png') });
await app.close();
process.stdout.write(JSON.stringify(report, null, 2) + String.fromCharCode(10));
