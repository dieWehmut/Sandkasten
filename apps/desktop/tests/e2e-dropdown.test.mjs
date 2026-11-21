import assert from 'node:assert/strict';
import test from 'node:test';

import { dropdownOptionState, selectDropdown } from '../scripts/e2e-dropdown.mjs';

function dropdown({ updatesSelection = true } = {}) {
  const state = { open: false, value: 'local', clicks: [] };
  const values = new Map([['local', false], ['isolated', true], ['api', false]]);
  const trigger = {
    async click() { state.open = !state.open; },
    async getAttribute(name) { assert.equal(name, 'aria-expanded'); return String(state.open); },
  };
  const list = {
    async waitFor({ state: expected }) { assert.equal(state.open, expected === 'visible'); },
    async press(key) { assert.equal(key, 'Escape'); state.open = false; },
  };
  const root = {
    locator(selector) {
      if (selector === '[data-dropdown-trigger]') return trigger;
      if (selector === '[role="listbox"]') return list;
      const value = selector.match(/^\[role="option"\]\[data-value="([^"]+)"\]$/)?.[1];
      assert.ok(value, `Unexpected locator ${selector}`);
      return {
        async waitFor({ state: expected }) {
          assert.equal(expected, 'visible');
          assert.equal(state.open, true);
          assert.ok(values.has(value), `No option ${value}`);
        },
        async getAttribute(name) {
          if (name === 'aria-disabled') return values.get(value) ? 'true' : null;
          assert.equal(name, 'aria-selected');
          return String(state.value === value);
        },
        async click() {
          state.clicks.push(value);
          assert.equal(values.get(value), false, 'disabled rows must never receive a click');
          if (updatesSelection) state.value = value;
          state.open = false;
        },
      };
    },
  };
  return { state, page: { locator(selector) { assert.equal(selector, '#backend'); return root; } } };
}

test('reads the disabled custom option without changing the selected backend', async () => {
  const { page, state } = dropdown();
  assert.deepEqual(await dropdownOptionState(page, '#backend', 'isolated'), { disabled: true, selected: false });
  assert.deepEqual(state, { open: false, value: 'local', clicks: [] });
});

test('clicks an enabled custom option and verifies its selected state', async () => {
  const { page, state } = dropdown();
  await selectDropdown(page, '#backend', 'api');
  assert.deepEqual(state, { open: false, value: 'api', clicks: ['api'] });
});

test('rejects a disabled backend before clicking and closes the listbox', async () => {
  const { page, state } = dropdown();
  await assert.rejects(selectDropdown(page, '#backend', 'isolated'), /isolated must be enabled/);
  assert.deepEqual(state, { open: false, value: 'local', clicks: [] });
});

test('fails when a click leaves the selected backend unchanged', async () => {
  const { page, state } = dropdown({ updatesSelection: false });
  await assert.rejects(selectDropdown(page, '#backend', 'api'), /api must become the selected dropdown option/);
  assert.equal(state.open, false);
});

test('a missing custom option fails instead of appearing enabled', async () => {
  const { page, state } = dropdown();
  await assert.rejects(dropdownOptionState(page, '#backend', 'missing'), /No option missing/);
  assert.equal(state.open, false);
});
