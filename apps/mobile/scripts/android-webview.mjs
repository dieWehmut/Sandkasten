import { chromium } from 'playwright-core';

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// A restarted app gets a new PID. Other apps, or an exiting WebView, can still
// expose debugging sockets, so discover only the current app's socket and wait
// for its Capacitor page before connecting.
export async function attachAndroidWebView({ adb, appId, port = 19222, timeout = 30000 }) {
  const started = Date.now(), end = started + timeout;
  const endpoint = `http://127.0.0.1:${port}`;
  const diagnostics = { appId, port, attempts: 0, pid: '', socket: '', targets: [], pages: [] };
  let browser, forwardedSocket;
  const appPage = (url) => /^https:\/\/localhost(?:\/|$)/.test(url);
  while (Date.now() < end) {
    try {
      diagnostics.attempts++;
      diagnostics.stage = 'app process';
      const pid = adb('shell', 'pidof', appId).trim().split(/\s+/).find(value => /^\d+$/.test(value));
      diagnostics.pid = pid ?? '';
      if (!pid) { await wait(100); continue; }
      diagnostics.stage = 'WebView debugging socket';
      const socket = `webview_devtools_remote_${pid}`;
      const sockets = adb('shell', 'cat', '/proc/net/unix').split('\n').map(line => line.trim().split(/\s+/).at(-1));
      diagnostics.sockets = sockets.filter(value => value?.startsWith('@webview_devtools_remote')).map(value => value.slice(1));
      if (!sockets.includes(`@${socket}`)) { await wait(100); continue; }
      diagnostics.socket = socket;
      if (forwardedSocket !== socket) {
        adb('forward', `tcp:${port}`, `localabstract:${socket}`);
        forwardedSocket = socket;
      }
      diagnostics.stage = 'WebView page target';
      const response = await fetch(`${endpoint}/json/list`, { signal: AbortSignal.timeout(Math.max(1, Math.min(1000, end - Date.now()))) });
      if (!response.ok) throw new Error(`WebView targets: HTTP ${response.status}`);
      const targets = await response.json();
      diagnostics.targets = targets.map(({ id, type, url }) => ({ id, type, url }));
      if (!targets.some(target => target.type === 'page' && appPage(target.url) && target.webSocketDebuggerUrl)) { await wait(100); continue; }
      // Recheck ownership after discovery in case the process exited meanwhile.
      if (!adb('shell', 'pidof', appId).trim().split(/\s+/).includes(pid)) continue;
      diagnostics.stage = 'CDP connection';
      // Android WebView cannot manage browser contexts or override downloads.
      browser = await chromium.connectOverCDP(endpoint, { noDefaults: true, timeout: Math.max(1, Math.min(10000, end - Date.now())) });
      diagnostics.stage = 'Playwright WebView page';
      const pageEnd = Math.min(end, Date.now() + 5000);
      while (Date.now() < pageEnd) {
        const pages = browser.contexts().flatMap(context => context.pages());
        diagnostics.pages = pages.map(page => page.url());
        const page = pages.find(page => appPage(page.url()));
        if (page) {
          diagnostics.stage = 'attached';
          diagnostics.elapsedMs = Date.now() - started;
          delete diagnostics.lastError;
          return { browser, page, diagnostics };
        }
        await wait(100);
      }
      throw new Error('CDP connected without the app page');
    } catch (error) {
      diagnostics.lastError = error.message;
      if (browser) { await browser.close().catch(() => {}); browser = null; }
      await wait(100);
    }
  }
  diagnostics.elapsedMs = Date.now() - started;
  const error = new Error(`Timed out attaching Android WebView: ${JSON.stringify(diagnostics)}`);
  error.diagnostics = diagnostics;
  throw error;
}
