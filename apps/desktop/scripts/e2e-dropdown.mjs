import assert from 'node:assert/strict';

// DropdownSelect renders a combobox and listbox, rather than a native select.
// Drive its visible rows and confirm the selected value through its ARIA state.
async function openDropdown(page, selector) {
  const root = page.locator(selector);
  await root.locator('[data-dropdown-trigger]').click();
  await root.locator('[role="listbox"]').waitFor({ state: 'visible' });
  return root;
}

async function closeDropdown(root) {
  if (await root.locator('[data-dropdown-trigger]').getAttribute('aria-expanded') === 'true') {
    await root.locator('[role="listbox"]').press('Escape');
    await root.locator('[role="listbox"]').waitFor({ state: 'detached' });
  }
}

export async function dropdownOptionState(page, selector, value) {
  const root = await openDropdown(page, selector);
  try {
    const row = root.locator(`[role="option"][data-value="${value}"]`);
    await row.waitFor({ state: 'visible' });
    return {
      disabled: await row.getAttribute('aria-disabled') === 'true',
      selected: await row.getAttribute('aria-selected') === 'true',
    };
  } finally {
    await closeDropdown(root);
  }
}

export async function selectDropdown(page, selector, value) {
  const root = await openDropdown(page, selector);
  try {
    const row = root.locator(`[role="option"][data-value="${value}"]`);
    await row.waitFor({ state: 'visible' });
    assert.notEqual(await row.getAttribute('aria-disabled'), 'true', `${value} must be enabled`);
    await row.click();
    await root.locator('[role="listbox"]').waitFor({ state: 'detached' });
  } finally {
    await closeDropdown(root);
  }
  const state = await dropdownOptionState(page, selector, value);
  assert.equal(state.selected, true, `${value} must become the selected dropdown option`);
}
