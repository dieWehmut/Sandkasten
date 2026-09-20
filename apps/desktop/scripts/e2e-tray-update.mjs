// Drives the tray's update action inside a real running app. The menu and its
// dialog are native surfaces that no page-level driver can read, so the run
// asks the app for the probe: the main process publishes every rebuilt tray
// menu and answers the update dialog instead of blocking on a modal.
import assert from 'node:assert/strict';

const UPDATE_ITEM = 'check-for-updates';
const POLL_INTERVAL_MS = 250;
const POLL_ATTEMPTS = 120;

function updateItem(menu) {
  return menu?.find((item) => item.id === UPDATE_ITEM);
}

async function trayState(app) {
  return app.evaluate(() => {
    const probe = globalThis.__sandkastenTrayProbe;
    if (!probe?.enabled) throw new Error('the tray probe was not enabled for this run');
    const updateOf = (menu) => {
      const item = menu.find((entry) => entry.id === 'check-for-updates');
      return { label: item?.label, enabled: item?.enabled };
    };
    return {
      menu: updateOf(probe.menu() ?? []),
      menus: probe.menus().map(updateOf),
      dialogs: probe.dialogs.map((dialog) => ({
        type: dialog.type, message: dialog.message, detail: dialog.detail, buttons: dialog.buttons,
      })),
      downloads: probe.downloads(),
    };
  });
}

// A scripted run cannot wait on a network round trip, so poll the probe until
// the check has finished and the menu came back to its enabled state.
async function waitForCheckToFinish(app, settled) {
  for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
    const state = await trayState(app);
    if (settled(state)) return state;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error(`the tray update check did not settle within 30s: ${JSON.stringify(await trayState(app))}`);
}

async function clickUpdateAction(app) {
  const clicked = await app.evaluate(() => {
    const item = globalThis.__sandkastenTrayProbe?.menu()?.find((entry) => entry.id === 'check-for-updates');
    if (typeof item?.click !== 'function') return false;
    void item.click();
    return true;
  });
  assert.equal(clicked, true, 'the real tray menu must expose the update action');
}

export async function verifyTrayUpdate({ app, scriptedTag, locale = 'zh', currentVersion, report }) {
  const localized = locale === 'zh';
  const live = scriptedTag === 'live';
  const expectedLatest = !live && scriptedTag !== 'none' && scriptedTag !== `v${currentVersion}`;
  report.update = { scriptedTag, locale };

  const before = await trayState(app);
  assert.ok(before.menu.label, 'the tray must offer a labelled update entry');
  assert.equal(before.menu.enabled, true, 'the update entry starts enabled');
  assert.deepEqual(before.dialogs, [], 'nothing may be reported before the action is used');
  assert.equal(before.downloads.length, 0, 'checking must never open a page by itself');
  report.update.initial = before.menu;
  if (localized) assert.match(before.menu.label, /检查更新/, 'the Chinese tray menu must localize the update entry');

  await clickUpdateAction(app);
  const settled = await waitForCheckToFinish(
    app,
    (state) => state.dialogs.length > 0 && state.menu.enabled === true,
  );
  // The scripted check can settle before a driver samples the live menu, so the
  // recorded rebuilds are what prove the progress state was shown.
  report.update.menus = settled.menus;
  const busy = settled.menus.find((menu) => menu.enabled === false);
  assert.ok(busy, 'the tray must show a progress state while the check runs');
  report.update.busy = busy;
  if (localized) assert.equal(busy.label, '正在检查更新…');

  assert.equal(settled.menu.enabled, true, 'the tray accepts another check once it settles');
  report.update.settled = { menu: settled.menu, dialog: settled.dialogs.at(-1) };
  assert.equal(settled.dialogs.length, 1, 'exactly one dialog reports the outcome');
  assert.equal(settled.downloads.length, 0, 'dismissing the dialog must not open a release page');

  const dialog = settled.dialogs[0];
  if (expectedLatest) {
    assert.match(dialog.detail, /9\.9\.9/, 'the dialog names the release the check found');
    assert.equal(dialog.buttons.length, 2, 'an available update offers the release page and a dismissal');
  } else if (live) {
    // The live run reaches GitHub, so it asserts the shape of a real answer
    // rather than a version this repository does not control.
    assert.ok(dialog.detail, 'a live check reports the versions it compared');
    assert.match(dialog.detail, new RegExp(currentVersion.replaceAll('.', '\\.')), 'a live check names the running version');
    assert.match(dialog.message, /最新|latest|new version|发现/i, 'a live check reports a real outcome');
  } else {
    assert.doesNotMatch(dialog.message, /新版本|new version/i, 'a scripted same-version release must not claim an update');
    assert.match(dialog.detail, new RegExp(currentVersion.replaceAll('.', '\\.')), 'the dialog names the running version');
  }

  return report.update;
}
