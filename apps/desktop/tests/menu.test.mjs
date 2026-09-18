import assert from 'node:assert/strict';
import test from 'node:test';

import { MENU_COMMANDS, buildMenuTemplate } from '../src/menu.mjs';

function menuOf(template, label) {
  const menu = template.find((entry) => entry.label === label);
  assert.ok(menu, `${label} menu must exist`);
  return menu.submenu;
}

test('the application menu forwards stable command ids', () => {
  const sent = [];
  const template = buildMenuTemplate({ send: (command) => sent.push(command), platform: 'win32' });

  assert.deepEqual(template.map((entry) => entry.label), ['File', 'Run', 'View', 'Help']);
  assert.equal(template.some((entry) => entry.role === 'appMenu'), false);

  const file = menuOf(template, 'File');
  const open = file.find((entry) => entry.label === 'Open Folder…');
  const save = file.find((entry) => entry.label === 'Save File');
  const close = file.find((entry) => entry.label === 'Close Editor');
  assert.equal(open.accelerator, 'CmdOrCtrl+O');
  assert.equal(save.accelerator, 'CmdOrCtrl+S');
  assert.equal(close.accelerator, 'CmdOrCtrl+W');
  assert.equal(file.at(-1).role, 'quit');

  const run = menuOf(template, 'Run');
  assert.equal(run.find((entry) => entry.label === 'Run Active File').accelerator, 'F5');
  assert.equal(run.find((entry) => entry.label === 'Stop Run').accelerator, 'Shift+F5');

  const view = menuOf(template, 'View');
  assert.equal(view.find((entry) => entry.label === 'Toggle Sidebar').accelerator, 'CmdOrCtrl+B');
  assert.equal(view.find((entry) => entry.label === 'Toggle Output Panel').accelerator, 'CmdOrCtrl+J');
  assert.equal(view.some((entry) => entry.role === 'toggleDevTools'), true);

  open.click();
  save.click();
  run.find((entry) => entry.label === 'Run Active File').click();
  menuOf(template, 'Help').find((entry) => entry.label === 'Setup Guide').click();
  assert.deepEqual(sent, [MENU_COMMANDS.openWorkspace, MENU_COMMANDS.save, MENU_COMMANDS.run, MENU_COMMANDS.setup]);
});

test('macOS keeps the standard application menu in front', () => {
  const template = buildMenuTemplate({ send: () => {}, platform: 'darwin' });
  assert.equal(template[0].role, 'appMenu');
  assert.equal(template.find((entry) => entry.label === 'File').submenu.at(-1).role, 'close');
});

test('a menu template requires a command sender', () => {
  assert.throws(() => buildMenuTemplate({}), /command sender/);
});