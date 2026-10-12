import assert from 'node:assert/strict';
import path from 'node:path';

import { selectTheme } from './e2e-theme.mjs';

// This drives xterm through its real input element. Output assertions read its
// accessibility tree, which represents the same screen painted on the canvas.
export async function verifyTerminal({ page, app, outputRoot }) {
  let reportRunInTerminal = false;
  let reportSuggestions = false;
  let reportArgumentSuggestions = false;
  let reportDirectorySuggestions = false;
  let reportNestedSuggestions = false;
  let reportCwdSuggestions = false;
  let reportPushdSuggestions = false;
  let reportPowerShellRun = false;
  let reportJavaScriptRun = false;
  let reportBashRun = false;
  let reportShellSourceMarked = false;
  let reportAliasInPalette = false;
  const profiles = await page.evaluate(() => window.sandkastenDesktop.terminal.profiles());
  assert.ok(profiles.length, 'at least one installed shell profile must be offered');
  const cmd = profiles.find((profile) => /command prompt|\bcmd\b/i.test(profile.label));
  assert.ok(cmd, 'Windows validation needs the installed Command Prompt profile');
  const powershell = profiles.find((profile) => profile.family === 'powershell');
  await page.keyboard.press('Control+Shift+Backquote');
  await page.waitForSelector('[data-testid="terminal-pane"]');
  const before = await page.locator('[data-testid="terminal-session"]').count();
  await page.selectOption('[data-testid="terminal-profile"]', cmd.id);
  await page.waitForFunction((count) => document.querySelectorAll('[data-testid="terminal-session"]').length > count, before);
  const firstId = await page.locator('[data-testid="terminal-pane"]:visible').last().getAttribute('data-session-id');
  const pane = (id) => `[data-testid="terminal-pane"][data-session-id="${id}"]`;
  const readScreen = async (id) => page.locator(`${pane(id)} .xterm-accessibility-tree`).innerText();
  const waitScreen = async (id, text, timeoutMs = 20_000) => {
    // The accessibility tree puts every terminal row on its own line, so a long
    // echoed command is split across rows when the pane is narrow. Comparing
    // without whitespace is what makes the assertion about the text, not about
    // where the terminal happened to wrap it.
    const squeeze = (value) => String(value).replace(/\s+/g, '');
    try {
      await page.waitForFunction(({ selector, text }) =>
        (document.querySelector(selector)?.textContent ?? '').replace(/\s+/g, '').includes(text),
      { selector: `${pane(id)} .xterm-accessibility-tree`, text: squeeze(text) }, { timeout: timeoutMs });
    } catch (cause) {
      // A failure here is otherwise a bare timeout: say what the terminal did
      // show, because the answer is usually in the last rows.
      const screen = await readScreen(id).catch(() => '<the screen could not be read>');
      const tail = String(screen).split('\n').filter(Boolean).slice(-12).join('\n');
      throw new Error(`the terminal never showed ${JSON.stringify(text)}.\nLast screen rows:\n${tail}`);
    }
  };
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

  // The palette command types the active file's interpreter command into the
  // shell the panel owns; the fixture's marker proves the program really ran.
  await page.keyboard.press('Control+Shift+P');
  await page.waitForSelector('[data-command="terminal.runFile"]');
  await page.click('[data-command="terminal.runFile"]');
  await waitScreen(firstId, 'E2E_TERMINAL_RUN');
  reportRunInTerminal = true;

  // A PowerShell script is not an argument to an interpreter: the host
  // PowerShell is asked to run the file, which the fixture proves.
  await page.click('[data-action="ide-open-hello.ps1"]');
  await page.waitForSelector('[data-action="ide-tab-hello.ps1"]');
  await page.keyboard.press('Control+Shift+P');
  await page.waitForSelector('[data-command="terminal.runFile"]');
  await page.click('[data-command="terminal.runFile"]');
  await waitScreen(firstId, 'E2E_PS1_RUN');
  reportPowerShellRun = true;

  // The same workbench entry runs the other interpreters the terminal shares
  // with the local runner: node for a JavaScript file, bash for a shell script.
  // The markers prove the session itself executed them.
  await page.click('[data-action="ide-open-hello.js"]');
  await page.waitForSelector('[data-action="ide-tab-hello.js"]');
  await page.keyboard.press('Control+Shift+P');
  await page.waitForSelector('[data-command="terminal.runFile"]');
  await page.click('[data-command="terminal.runFile"]');
  await waitScreen(firstId, 'E2E_JS_RUN');
  reportJavaScriptRun = true;

  await page.click('[data-action="ide-open-hello.sh"]');
  await page.waitForSelector('[data-action="ide-tab-hello.sh"]');
  await page.keyboard.press('Control+Shift+P');
  await page.waitForSelector('[data-command="terminal.runFile"]');
  await page.click('[data-command="terminal.runFile"]');
  // `bash` on Windows is usually the WSL launcher, and a cold distro takes
  // seconds before the script it was handed can print anything.
  await waitScreen(firstId, 'E2E_SH_RUN', 60_000);
  reportBashRun = true;

  await page.click('[data-action="ide-open-hello.py"]');
  await page.waitForSelector('[data-action="ide-tab-hello.py"]');

  await page.locator(`${pane(firstId)} .xterm-helper-textarea`).focus();
  await page.keyboard.press('Control+w');
  await page.keyboard.press('Control+n');
  assert.equal(await page.locator('[data-action="ide-tab-hello.py"]').count(), 1, 'terminal Ctrl+W must not close the editor through its native accelerator');
  assert.equal(await page.locator('[data-testid="ide-new-file-form"]').count(), 0, 'terminal Ctrl+N must not create an editor file');
  await page.keyboard.press('Control+c');

  // Typing the start of a command offers the commands this shell can run, and
  // choosing one types only the rest of the word. The target comes from the
  // shell's own list — the executables on its PATH here, since a cmd session
  // reports nothing about itself — and its three-letter prefix has to be unique
  // so the suggestion is certain to be in the strip.
  const published = await page.evaluate((profileId) => window.sandkastenDesktop.terminal.commands(profileId), cmd.id);
  const names = published.names;
  const byPrefix = new Map();
  for (const name of names) {
    const prefix = name.slice(0, 3).toLowerCase();
    byPrefix.set(prefix, (byPrefix.get(prefix) ?? 0) + 1);
  }
  const target = names.find((name) => name.length > 3 && byPrefix.get(name.slice(0, 3).toLowerCase()) === 1);
  assert.ok(target, 'the shell must publish at least one suggestible command');
  await page.keyboard.type(target.slice(0, 3));
  await page.waitForSelector(`${pane(firstId)} [data-testid="terminal-suggestion"][data-command="${target}"]`, { timeout: 10_000 });
  await page.click(`${pane(firstId)} [data-testid="terminal-suggestion"][data-command="${target}"]`);
  await waitScreen(firstId, target);
  reportSuggestions = true;
  // Discard the half-typed line before the assertions below reuse the shell.
  await page.keyboard.press('Control+c');
  await enter(firstId, 'echo E2E^_CLEAR^_OK');
  await waitScreen(firstId, 'E2E_CLEAR_OK');

  // An argument completes from the workspace: `echo hel` offers hello.py.
  await page.keyboard.type('echo hel');
  await page.waitForSelector(`${pane(firstId)} [data-testid="terminal-suggestion"][data-command="hello.py"]`, { timeout: 10_000 });
  await page.click(`${pane(firstId)} [data-testid="terminal-suggestion"][data-command="hello.py"]`);
  await waitScreen(firstId, 'echo hello.py');
  reportArgumentSuggestions = true;
  await page.keyboard.press('Control+c');
  await enter(firstId, 'echo E2E^_ARGS^_OK');
  await waitScreen(firstId, 'E2E_ARGS_OK');

  // A folder completes as a directory argument, carrying its separator.
  await page.keyboard.type('cd scr');
  await page.waitForSelector(`${pane(firstId)} [data-testid="terminal-suggestion"][data-command="scripts/"]`, { timeout: 10_000 });
  await page.click(`${pane(firstId)} [data-testid="terminal-suggestion"][data-command="scripts/"]`);
  await waitScreen(firstId, 'cd scripts/');
  reportDirectorySuggestions = true;
  await page.keyboard.press('Control+c');
  await enter(firstId, 'echo E2E^_DIRS^_OK');
  await waitScreen(firstId, 'E2E_DIRS_OK');

  // A file inside that folder completes through the folder.
  await page.keyboard.type('cd scripts/task');
  await page.waitForSelector(`${pane(firstId)} [data-testid="terminal-suggestion"][data-command="scripts/task.py"]`, { timeout: 10_000 });
  await page.click(`${pane(firstId)} [data-testid="terminal-suggestion"][data-command="scripts/task.py"]`);
  await waitScreen(firstId, 'cd scripts/task.py');
  reportNestedSuggestions = true;
  await page.keyboard.press('Control+c');
  await enter(firstId, 'echo E2E^_NESTED^_OK');
  await waitScreen(firstId, 'E2E_NESTED_OK');

  // After moving into a folder, the names inside it complete: the strip follows
  // the shell's directory instead of offering paths that no longer resolve.
  await enter(firstId, 'cd scripts');
  await enter(firstId, 'echo E2E^_CWD^_IN');
  await waitScreen(firstId, 'E2E_CWD_IN');
  await page.keyboard.type('cd ta');
  await page.waitForSelector(`${pane(firstId)} [data-testid="terminal-suggestion"][data-command="task.py"]`, { timeout: 10_000 });
  await page.click(`${pane(firstId)} [data-testid="terminal-suggestion"][data-command="task.py"]`);
  await waitScreen(firstId, 'cd task.py');
  reportCwdSuggestions = true;
  await page.keyboard.press('Control+c');
  await enter(firstId, 'cd ..');
  await enter(firstId, 'echo E2E^_CWD^_OK');
  await waitScreen(firstId, 'E2E_CWD_OK');

  // The shell's directory stack is followed as well: `pushd` completes inside
  // that folder, and `popd` puts the completions back where they were.
  await enter(firstId, 'pushd scripts');
  await enter(firstId, 'echo E2E^_PUSHD^_IN');
  await waitScreen(firstId, 'E2E_PUSHD_IN');
  await page.keyboard.type('cd ta');
  await page.waitForSelector(`${pane(firstId)} [data-testid="terminal-suggestion"][data-command="task.py"]`, { timeout: 10_000 });
  reportPushdSuggestions = true;
  await page.keyboard.press('Control+c');
  await enter(firstId, 'popd');
  await enter(firstId, 'echo E2E^_PUSHD^_OK');
  await waitScreen(firstId, 'E2E_PUSHD_OK');

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
  await page.keyboard.press('Control+Shift+P');
  await page.waitForSelector('[data-testid="command-palette"]');
  await page.click('[data-command="view.toggleSetup"]');
  await page.waitForSelector('[data-testid="setup-welcome"]');
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
    await selectTheme(page, theme);
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

  // A PowerShell session publishes its cmdlets through the host, and the strip
  // marks the ones the shell reports about itself. This is the whole path with
  // the real list — about three thousand names — rather than a test double.
  if (powershell) {
    const beforePowerShell = await page.locator('[data-testid="terminal-session"]').count();
    await page.selectOption('[data-testid="terminal-profile"]', powershell.id);
    await page.waitForFunction((count) => document.querySelectorAll('[data-testid="terminal-session"]').length > count, beforePowerShell);
    const shellId = await page.locator('[data-testid="terminal-pane"]:visible').last().getAttribute('data-session-id');
    await page.locator(`${pane(shellId)} .xterm-helper-textarea`).focus();
    await page.keyboard.type('Get-Ch');
    const marked = `${pane(shellId)} [data-testid="terminal-suggestion"][data-source="shell"]`;
    await page.waitForSelector(marked, { timeout: 60_000 });
    const title = await page.locator(marked).first().getAttribute('title');
    assert.match(title, /cmdlet/i, 'the marked entry has to say what kind of command it is');
    reportShellSourceMarked = true;
    await page.keyboard.press('Control+c');

    // An alias is a command too: `gci` is not a file anywhere, and the palette has
    // to offer it because the shell reported it.
    await page.keyboard.press('Control+Shift+P');
    await page.fill('[role="combobox"]', '>gci');
    await page.waitForSelector('[data-command="shell.gci"]', { timeout: 30_000 });
    reportAliasInPalette = true;
    await page.keyboard.press('Escape');

    await page.click(`[data-testid="terminal-session"][data-session-id="${shellId}"]`);
    await page.click('[data-action="terminal-close"]');
    await page.waitForFunction((id) => !document.querySelector(`[data-testid="terminal-session"][data-session-id="${id}"]`), shellId);
  }

  return { profiles: profiles.map((profile) => profile.label), persistentState: true, split: true, interrupt: true, resize: { before: sizeBefore, after: sizeAfter }, close: true, initialOutput: true, runInTerminal: reportRunInTerminal, suggestions: reportSuggestions, argumentSuggestions: reportArgumentSuggestions, directorySuggestions: reportDirectorySuggestions, nestedSuggestions: reportNestedSuggestions, cwdSuggestions: reportCwdSuggestions, pushdSuggestions: reportPushdSuggestions, powershellRun: reportPowerShellRun, javascriptRun: reportJavaScriptRun, bashRun: reportBashRun, shellSourceMarked: reportShellSourceMarked, aliasInPalette: reportAliasInPalette };
}
