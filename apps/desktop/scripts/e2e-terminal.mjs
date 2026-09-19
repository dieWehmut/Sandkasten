import assert from 'node:assert/strict';
import path from 'node:path';

// This drives xterm through its real input element. Output assertions read its
// accessibility tree, which represents the same screen painted on the canvas.
export async function verifyTerminal({ page, app, outputRoot }) {
  const profiles = await page.evaluate(() => window.sandkastenDesktop.terminal.profiles());
  assert.ok(profiles.length, 'at least one installed shell profile must be offered');
  const cmd = profiles.find((profile) => /command prompt|\bcmd\b/i.test(profile.label));
  assert.ok(cmd, 'Windows validation needs the installed Command Prompt profile');
  await page.keyboard.press('Control+Shift+Backquote');
  await page.waitForSelector('[data-testid="terminal-pane"]');
  const before = await page.locator('[data-testid="terminal-session"]').count();
  await page.selectOption('[data-testid="terminal-profile"]', cmd.id);
  await page.waitForFunction((count) => document.querySelectorAll('[data-testid="terminal-session"]').length > count, before);
  const firstId = await page.locator('[data-testid="terminal-pane"]:visible').last().getAttribute('data-session-id');
  const pane = (id) => `[data-testid="terminal-pane"][data-session-id="${id}"]`;
  const readScreen = async (id) => page.locator(`${pane(id)} .xterm-accessibility-tree`).innerText();
  const waitScreen = async (id, text) => page.waitForFunction(({ selector, text }) =>
    document.querySelector(selector)?.textContent?.includes(text),
  { selector: `${pane(id)} .xterm-accessibility-tree`, text }, { timeout: 20_000 });
  const enter = async (id, text) => {
    await page.locator(`${pane(id)} .xterm-helper-textarea`).focus();
    await page.keyboard.type(text);
    await page.keyboard.press('Enter');
  };

  const root = await page.evaluate(() => window.sandkastenDesktop.workspace.root());
  await waitScreen(firstId, root.path);
  assert.match(await readScreen(firstId), /Microsoft Windows/, 'the shell startup banner must survive the attach handshake');

  await page.click('[data-action="ide-open-hello.py"]');
  await page.waitForSelector('[data-action="ide-tab-hello.py"]');
  await page.locator(`${pane(firstId)} .xterm-helper-textarea`).focus();
  await page.keyboard.press('Control+w');
  await page.keyboard.press('Control+n');
  assert.equal(await page.locator('[data-action="ide-tab-hello.py"]').count(), 1, 'terminal Ctrl+W must not close the editor through its native accelerator');
  assert.equal(await page.locator('[data-testid="ide-new-file-form"]').count(), 0, 'terminal Ctrl+N must not create an editor file');
  await page.keyboard.press('Control+c');

  // Escape separators in the entered command: the unescaped marker appears
  // only in shell output, so command echo cannot make this assertion pass.
  await enter(firstId, 'echo E2E^_PTY^_READY');
  await waitScreen(firstId, 'E2E_PTY_READY');
  await enter(firstId, 'set SANDKASTEN_E2E_STATE=retained');
  await enter(firstId, 'mkdir terminal-child');
  await enter(firstId, 'cd terminal-child');
  await enter(firstId, 'echo E2E^_STATE^_%SANDKASTEN_E2E_STATE%');
  await waitScreen(firstId, 'E2E_STATE_retained');
  assert.match(await readScreen(firstId), /terminal-child/);

  // Output mode and setup temporarily hide the terminal; its process and
  // emulator must both survive, including environment and current directory.
  await page.keyboard.press('Control+Backquote');
  await page.keyboard.press('Control+Backquote');
  await page.waitForSelector(`${pane(firstId)}:visible`);
  await page.click('[data-testid="open-setup-guide"]');
  await page.click('[data-testid="setup-dismiss"]');
  await page.waitForSelector(`${pane(firstId)}:visible`);
  await enter(firstId, 'echo E2E^_AFTER^_%SANDKASTEN_E2E_STATE%');
  await waitScreen(firstId, 'E2E_AFTER_retained');

  // Split creates a separate shell without discarding the original session.
  const countBeforeSplit = await page.locator('[data-testid="terminal-session"]').count();
  await page.click('[data-action="terminal-split"]');
  await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="terminal-pane"]')]
    .filter((element) => element.getBoundingClientRect().width > 0).length === 2);
  const visibleIds = await page.locator('[data-testid="terminal-pane"]:visible').evaluateAll((panes) => panes.map((element) => element.dataset.sessionId));
  const secondId = visibleIds.find((id) => id !== firstId);
  assert.ok(secondId);
  assert.equal(await page.locator('[data-testid="terminal-session"]').count(), countBeforeSplit + 1);
  await enter(secondId, 'echo E2E^_SECOND^_SHELL');
  await waitScreen(secondId, 'E2E_SECOND_SHELL');

  // ConPTY hands a child an invalid stdin handle, so the dimensions must
  // come from stdout instead of fd 0.
  const shellSize = async (label) => {
    await enter(firstId, `python -c "import sys,os; s=os.get_terminal_size(sys.stdout.fileno()); print('E2E_SIZE_'+'${label}',s.columns,s.lines)"`);
    await waitScreen(firstId, `E2E_SIZE_${label}`);
    const match = (await readScreen(firstId)).match(new RegExp(`E2E_SIZE_${label}\\s+(\\d+)\\s+(\\d+)`));
    assert.ok(match, 'the actual shell must report terminal dimensions');
    return { cols: Number(match[1]), rows: Number(match[2]) };
  };
  const sizeBefore = await shellSize('BEFORE');

  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 720));
  await page.waitForFunction(() => window.outerWidth === 1280);
  const sizeAfter = await shellSize('AFTER');
  assert.notEqual(sizeAfter.cols, sizeBefore.cols, 'window resizing must reach the real PTY');
  await enter(firstId, 'echo E2E^_RESIZE^_OK');
  await waitScreen(firstId, 'E2E_RESIZE_OK');
  const bounds = await page.locator(`${pane(firstId)} .xterm`).evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom, viewportWidth: innerWidth, viewportHeight: innerHeight };
  });
  assert.ok(bounds.width > 50 && bounds.height > 40);
  assert.ok(bounds.right <= bounds.viewportWidth + 1 && bounds.bottom <= bounds.viewportHeight + 1);

  // Interrupt a genuinely running program, then run another command in the
  // same shell to prove it remains interactive after Ctrl+C.
  await enter(firstId, 'python -c "import time; print(\'E2E\'+chr(95)+\'WAIT\',flush=True); time.sleep(30)"');
  await waitScreen(firstId, 'E2E_WAIT');
  await page.keyboard.press('Control+c');
  await enter(firstId, 'echo E2E^_INTERRUPT^_OK');
  await waitScreen(firstId, 'E2E_INTERRUPT_OK');

  for (const theme of ['light', 'dark']) {
    if (await page.getAttribute('html', 'data-theme') !== theme) {
      await page.click('[data-action="toggle-theme"]');
      await page.waitForFunction((value) => document.documentElement.dataset.theme === value, theme);
    }
    await page.screenshot({ path: path.join(outputRoot, `desktop-terminal-${theme}.png`) });
  }

  await page.click(`[data-testid="terminal-session"][data-session-id="${secondId}"]`);
  await page.click('[data-action="terminal-close"]');
  await page.waitForFunction((id) => !document.querySelector(`[data-testid="terminal-session"][data-session-id="${id}"]`), secondId);
  assert.equal(await page.locator('[data-testid="terminal-session"]').count(), countBeforeSplit);
  // A closed session is no longer addressable through the host bridge.
  const rejected = await page.evaluate(async (id) => {
    try { await window.sandkastenDesktop.terminal.write({ id, data: 'echo should-not-run\r' }); return false; }
    catch { return true; }
  }, secondId);
  assert.equal(rejected, true);
  return { profiles: profiles.map((profile) => profile.label), persistentState: true, split: true, interrupt: true, resize: { before: sizeBefore, after: sizeAfter }, close: true, initialOutput: true };
}
