import assert from 'node:assert/strict';
import test from 'node:test';

import { createTrayProbe, E2E_PROBE_ENV } from '../src/tray-probe.mjs';

test('stays inert unless the end-to-end probe is requested', () => {
  const target = {};
  const probe = createTrayProbe({ environment: {}, target });
  assert.equal(probe.enabled, false);
  assert.equal(probe.menu(), undefined);
  assert.equal(probe.showMessageBox, undefined);
  assert.equal(E2E_PROBE_ENV, 'SANDKASTEN_E2E_PROBE');
  assert.deepEqual(target, {}, 'a normal launch must not publish any probe state');
});

test('publishes the live tray menu and answers dialogs instead of blocking on a modal', async () => {
  const target = {};
  const probe = createTrayProbe({ environment: { SANDKASTEN_E2E_PROBE: '1' }, target });
  assert.equal(probe.enabled, true);
  assert.equal(target.__sandkastenTrayProbe, probe);

  const first = [{ id: 'check-for-updates', label: 'Check for updates...', enabled: true }];
  const second = [{ id: 'check-for-updates', label: 'Checking for updates...', enabled: false }];
  probe.onMenuChange(first);
  assert.deepEqual(probe.menu(), first);
  probe.onMenuChange(second);
  assert.deepEqual(probe.menu(), second, 'the newest menu wins');
  assert.deepEqual(
    probe.menus().map((menu) => menu[0].enabled),
    [true, false],
    'every rebuild is recorded so a fast check still shows its progress state',
  );

  const options = { type: 'info', buttons: ['Open release page', 'Later'], cancelId: 1 };
  assert.deepEqual(await probe.showMessageBox(options), { response: 1 }, 'the cancel button answers by default');
  assert.deepEqual(probe.dialogs, [options]);
  probe.answer(0);
  assert.deepEqual(await probe.showMessageBox(options), { response: 0 }, 'a scripted answer overrides the default');
  assert.equal(probe.openExternal('https://github.com/dieWehmut/Sandkasten/releases/tag/v0.2.0'), undefined);
  assert.deepEqual(probe.downloads(), ['https://github.com/dieWehmut/Sandkasten/releases/tag/v0.2.0']);
});

test('serves a scripted release feed only when a scripted check is requested', async () => {
  const live = createTrayProbe({ environment: { SANDKASTEN_E2E_PROBE: '1' }, target: {} });
  assert.equal(live.fetch, undefined, 'a plain probe run must keep reaching the real GitHub API');

  const scripted = createTrayProbe({
    environment: { SANDKASTEN_E2E_PROBE: '1', SANDKASTEN_E2E_RELEASE: 'v9.9.9' },
    target: {},
  });
  const response = await scripted.fetch('https://api.github.com/repos/dieWehmut/Sandkasten/releases/latest', {});
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { tag_name: 'v9.9.9', draft: false, prerelease: false });

  const missing = createTrayProbe({
    environment: { SANDKASTEN_E2E_PROBE: '1', SANDKASTEN_E2E_RELEASE: 'none' },
    target: {},
  });
  assert.equal((await missing.fetch('https://api.github.com/repos/dieWehmut/Sandkasten/releases/latest', {})).status, 404);
  assert.throws(
    () => createTrayProbe({ environment: { SANDKASTEN_E2E_PROBE: '1', SANDKASTEN_E2E_RELEASE: '../other' }, target: {} }),
    /release tag/i,
  );

  const networked = createTrayProbe({
    environment: { SANDKASTEN_E2E_PROBE: '1', SANDKASTEN_E2E_RELEASE: 'live' },
    target: {},
  });
  assert.equal(networked.fetch, undefined, '"live" must leave the request on the real GitHub API');
});
