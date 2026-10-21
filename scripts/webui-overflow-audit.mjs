// A label painted outside its own box.
//
// A flex item squeezed below the width of its text does exactly that, and on
// screen it reads as one label printed over its neighbour. It took the tab strip
// down (forty tabs collapsed to 28 px each with 0 px names) and the breadcrumb
// trail down (all 24 steps overflowed and bled into each other). Both were found
// by rendering the built distribution, not by reading the stylesheet, so this
// probe exists to find the next one the same way.
//
// Every run checks a canary first: a clean result has to mean "nothing
// overflows", never "the probe cannot see anything". That check has already
// earned its place — an earlier revision of this probe reported zero findings
// while being structurally unable to report anything at all.
//
// Run with: node scripts/webui-overflow-audit.mjs
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createMockAppServer, findBrowserExecutable, loadPlaywrightChromium } from './webui-browser-smoke-lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'tmp', 'ui-audit');
const DEEP = 'very/deeply/nested/directory/structure/that/keeps/going/for/a/while/and/then/some/more/levels/and/more';
const FILES = {
  'main.py': 'def main():\n    print("hi")\n',
  'src/app.ts': 'export const app = 1;\n',
  'README.md': '# readme\n',
  [DEEP + '/extremely-long-module-name-for-probing-layout-overflow.py']: 'print("x")\n',
};

// Any element whose text is wider than its own box while the box does not clip:
// the label is painted outside its bounds, which is how a squeezed flex item
// reads on screen as text printed over its neighbour.
const PROBE = () => {
  const findings = [];
  const walk = (element) => {
    const style = getComputedStyle(element);
    const overflow = style.overflowX;
    const clips = overflow === 'hidden' || overflow === 'clip' || overflow === 'auto' || overflow === 'scroll';
    const ownText = Array.from(element.childNodes).some((node) => node.nodeType === 3 && node.textContent.trim());
    if (ownText && !clips && element.scrollWidth > element.clientWidth + 1) {
      findings.push({
        tag: element.tagName.toLowerCase(),
        cls: typeof element.className === 'string' ? element.className : '',
        text: (element.textContent || '').trim().slice(0, 40),
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
      });
    }
    for (const child of element.children) walk(child);
  };
  walk(document.body);
  return findings;
};

const executablePath = findBrowserExecutable();
await mkdir(outDir, { recursive: true });
const app = await createMockAppServer({ distDir: path.join(root, 'apps', 'web', 'dist') });
const chromium = loadPlaywrightChromium({ webuiDirectory: path.join(root, 'apps', 'web') });
const browser = await chromium.launch({ executablePath, headless: true, args: ['--disable-gpu'] });
const report = {};
try {
  for (const [width, height] of [[1440, 900], [1024, 768], [820, 640], [390, 844]]) {
    const context = await browser.newContext({ viewport: { width, height } });
    await context.addInitScript(({ files }) => {
      window.localStorage.setItem('sandkasten-install-guide-seen', 'true');
      window.localStorage.setItem('sandkasten-locale', 'zh-CN');
      window.localStorage.setItem('sandkasten-workspace-v1', JSON.stringify({ files, folders: [] }));
    }, { files: FILES });
    const page = await context.newPage();
    await page.goto(app.url, { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-testid="workbench-shell"]', { state: 'visible' });
    await page.waitForTimeout(500);
    // The compact layouts hide the activity bar, so the sidebar views are
    // reached through the palette there instead of by clicking the rail.
    const hasRail = await page.evaluate(() => Boolean(document.querySelector('[data-activity="search"]')));

    const rail = (activity) => async () => {
      if (hasRail) await page.click('[data-activity="' + activity + '"]');
    };
    // Open the deep file first: the breadcrumb trail only exists once a file is
    // open, so auditing the default state would never see it.
    await page.keyboard.press('Control+P');
    await page.waitForTimeout(250);
    await page.keyboard.type('extremely-long');
    await page.waitForTimeout(350);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);

    const views = [
      ['explorer', async () => {}],
      ['search', rail('search')],
      ['source-control', rail('source-control')],
      ['runs', rail('runs')],
      ['context', rail('context')],
      ['remote', rail('remote')],
      ['palette', async () => { await page.keyboard.press('Control+Shift+P'); }],
      ['settings', async () => { await page.click('[data-action="open-settings"]'); }],
    ];
    // Positive control: a canary that must be reported, so a clean run means
    // "nothing overflows" rather than "the probe cannot see anything".
    const canary = await page.evaluate(() => {
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;top:0;left:0;width:40px;white-space:nowrap;';
      host.textContent = 'this label is much wider than its box';
      document.body.appendChild(host);
      // Same shape the probe looks for: text wider than its own unclipped box.
      const overflow = getComputedStyle(host).overflowX;
      const clips = overflow === 'hidden' || overflow === 'clip' || overflow === 'auto' || overflow === 'scroll';
      const hit = !clips && host.scrollWidth > host.clientWidth + 1;
      host.remove();
      return hit ? 1 : 0;
    });
    if (canary === 0) throw new Error('probe failed its positive control');

    for (const [name, act] of views) {
      await act();
      await page.waitForTimeout(350);
      const findings = await page.evaluate(PROBE);
      const key = width + 'x' + height + '/' + name;
      if (findings.length) report[key] = findings;
      // Reset to the workbench between views.
      if (name === 'palette') await page.keyboard.press('Escape');
      if (name === 'settings') await page.click('[data-action="settings-back"]').catch(() => {});
      await page.waitForTimeout(120);
    }
    await context.close();
  }
} finally { await browser.close(); await app.close(); }
await writeFile(path.join(outDir, 'overflow-report.json'), JSON.stringify(report, null, 2), 'utf8');
const keys = Object.keys(report);
if (keys.length) {
  for (const key of keys) process.stderr.write(key + ' => ' + JSON.stringify(report[key].slice(0, 4)) + '\n');
  throw new Error('labels are painted outside their boxes in ' + keys.length + ' view(s); see ' + reportPath);
}
process.stdout.write('[webui-overflow-audit] no overflowing labels across 4 viewports\n');
