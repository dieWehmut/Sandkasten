import { flushPromises } from '@vue/test-utils';
import type { DOMWrapper, VueWrapper } from '@vue/test-utils';

/**
 * Drives a `DropdownSelect` the way a user does: open the list, then click the row.
 *
 * The control used to be a native `<select>`, so tests could call `setValue`. That
 * API only exists on form elements, and the listbox rows are buttons-free `<li>`
 * elements, so the interaction has to be spelled out — and doing so also keeps the
 * tests honest about what a click actually reaches.
 */
export async function chooseDropdown(
  wrapper: VueWrapper | DOMWrapper<Element>,
  triggerSelector: string,
  optionLabelOrValue: string,
): Promise<void> {
  const trigger = wrapper.get(`${triggerSelector} [data-dropdown-trigger]`);
  await trigger.trigger('click');
  await flushPromises();

  const rows = wrapper.findAll(`${triggerSelector} [role="option"]`);
  const row = rows.find((candidate) => candidate.text().trim() === optionLabelOrValue
    || candidate.attributes('data-value') === optionLabelOrValue);
  if (!row) {
    throw new Error(
      `no dropdown row matching "${optionLabelOrValue}"; rows: ${rows.map((r) => r.text().trim()).join(' | ')}`,
    );
  }
  await row.trigger('click');
  await flushPromises();
}

/** Reads the label the closed control is showing. */
export function dropdownValue(wrapper: VueWrapper | DOMWrapper<Element>, triggerSelector: string): string {
  return wrapper.get(`${triggerSelector} .dropdown__value`).text().trim();
}

/** Opens a dropdown and returns its rows, so a test can inspect availability. */
export async function openDropdown(
  wrapper: VueWrapper | DOMWrapper<Element>,
  triggerSelector: string,
): Promise<DOMWrapper<Element>[]> {
  await wrapper.get(`${triggerSelector} [data-dropdown-trigger]`).trigger('click');
  await flushPromises();
  return wrapper.findAll(`${triggerSelector} [role="option"]`);
}

/** The row for one value, after `openDropdown`. */
export function dropdownRow(
  rows: DOMWrapper<Element>[],
  value: string,
): DOMWrapper<Element> {
  const row = rows.find((candidate) => candidate.attributes('data-value') === value);
  if (!row) throw new Error(`no dropdown row for "${value}"; rows: ${rows.map((r) => r.attributes('data-value')).join(', ')}`);
  return row;
}
