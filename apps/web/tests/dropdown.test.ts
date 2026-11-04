import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, test } from 'vitest';
import DropdownSelect from '../src/components/DropdownSelect.vue';
import type { DropdownOption } from '../src/components/dropdownOptions';

const options: DropdownOption[] = [
  { value: 'local', label: 'Local', hint: 'Uses the host toolchain' },
  { value: 'isolated', label: 'Isolated', hint: 'Runs inside WSL2', disabled: true },
  { value: 'api', label: 'API', hint: 'Runs on the API host' },
];

function mountDropdown(modelValue = 'local') {
  return mount(DropdownSelect, { props: { modelValue, options, label: 'Execution' }, attachTo: document.body });
}

describe('themed dropdown', () => {
  test('shows the selected option and no native select element', () => {
    const wrapper = mountDropdown();
    expect(wrapper.get('.dropdown__value').text()).toBe('Local');
    // The whole point of the component: no native select popup to be styled.
    expect(wrapper.find('select').exists()).toBe(false);
    expect(wrapper.find('option').exists()).toBe(false);
  });

  test('opens a listbox carrying every option, with the selected row marked', async () => {
    const wrapper = mountDropdown();
    expect(wrapper.find('[role="listbox"]').exists()).toBe(false);

    await wrapper.get('[data-dropdown-trigger]').trigger('click');
    const rows = wrapper.findAll('[role="option"]');
    expect(rows.map((row) => row.text())).toEqual(['Local', 'Isolated', 'API']);
    expect(rows.map((row) => row.attributes('aria-selected'))).toEqual(['true', 'false', 'false']);
    // Each row explains itself, and the disabled one says so.
    expect(rows[1].attributes('aria-disabled')).toBe('true');
    expect(rows[0].attributes('title')).toBe('Uses the host toolchain');
  });

  test('choosing a row emits the value and closes the list', async () => {
    const wrapper = mountDropdown();
    await wrapper.get('[data-dropdown-trigger]').trigger('click');
    await wrapper.findAll('[role="option"]')[2].trigger('click');
    expect(wrapper.emitted('update:modelValue')).toEqual([['api']]);
    expect(wrapper.find('[role="listbox"]').exists()).toBe(false);
  });

  test('refuses a disabled row', async () => {
    const wrapper = mountDropdown();
    await wrapper.get('[data-dropdown-trigger]').trigger('click');
    await wrapper.findAll('[role="option"]')[1].trigger('click');
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    expect(wrapper.find('[role="listbox"]').exists()).toBe(true);
  });

  test('does not emit when the chosen row is already selected', async () => {
    const wrapper = mountDropdown('api');
    await wrapper.get('[data-dropdown-trigger]').trigger('click');
    await wrapper.findAll('[role="option"]')[2].trigger('click');
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
  });

  test('walks the list with the keyboard and commits with Enter', async () => {
    const wrapper = mountDropdown();
    const trigger = wrapper.get('[data-dropdown-trigger]');
    await trigger.trigger('keydown', { key: 'ArrowDown' });
    const list = wrapper.get('[role="listbox"]');

    // The disabled row is skipped rather than landed on.
    await list.trigger('keydown', { key: 'ArrowDown' });
    expect(wrapper.get('[data-value="api"]').attributes('data-active')).toBe('true');
    await list.trigger('keydown', { key: 'Enter' });
    expect(wrapper.emitted('update:modelValue')).toEqual([['api']]);
  });

  test('Escape closes the list without changing the value', async () => {
    const wrapper = mountDropdown();
    await wrapper.get('[data-dropdown-trigger]').trigger('click');
    await wrapper.get('[role="listbox"]').trigger('keydown', { key: 'Escape' });
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    expect(wrapper.find('[role="listbox"]').exists()).toBe(false);
    expect(wrapper.get('.dropdown__value').text()).toBe('Local');
  });

  test('opening the list takes focus, so the keys reach it', async () => {
    // Without this the arrow keys and Escape fall through to the page behind, and
    // on the settings screen Escape closed the whole page instead of the list.
    const wrapper = mountDropdown();
    await wrapper.get('[data-dropdown-trigger]').trigger('click');
    await flushPromises();
    expect(document.activeElement).toBe(wrapper.get('[role="listbox"]').element);
  });

  test('Escape inside the list does not bubble out to the page', async () => {
    const wrapper = mountDropdown();
    let escapedToPage = 0;
    const onKeydown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') escapedToPage += 1;
    };
    document.addEventListener('keydown', onKeydown);
    try {
      await wrapper.get('[data-dropdown-trigger]').trigger('click');
      await wrapper.get('[role="listbox"]').trigger('keydown', { key: 'Escape' });
      expect(escapedToPage).toBe(0);
    } finally {
      document.removeEventListener('keydown', onKeydown);
    }
  });

  test('a pointer press outside the control closes the list', async () => {
    const wrapper = mountDropdown();
    await wrapper.get('[data-dropdown-trigger]').trigger('click');
    expect(wrapper.find('[role="listbox"]').exists()).toBe(true);
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await flushPromises();
    expect(wrapper.find('[role="listbox"]').exists()).toBe(false);
  });

  test('a disabled control never opens', async () => {
    const wrapper = mount(DropdownSelect, {
      props: { modelValue: 'local', options, label: 'Execution', disabled: true },
      attachTo: document.body,
    });
    await wrapper.get('[data-dropdown-trigger]').trigger('click');
    expect(wrapper.find('[role="listbox"]').exists()).toBe(false);
    expect(wrapper.get('[data-dropdown-trigger]').attributes('disabled')).toBeDefined();
  });

  test('shows the placeholder row when the value matches no option', () => {
    // The runtime picker passes the caller's language, which no longer exists once
    // detection finds nothing, so nothing matched and the trigger rendered blank —
    // an empty box reads as a broken control rather than a deliberate empty state.
    const wrapper = mount(DropdownSelect, {
      props: {
        modelValue: 'python',
        options: [{ value: '', label: 'No runtimes available', disabled: true }] as DropdownOption[],
        label: 'Runtime',
        disabled: true,
      },
      attachTo: document.body,
    });
    expect(wrapper.get('.dropdown__value').text()).toBe('No runtimes available');
  });

  test('still renders nothing for an ordinary list with no match', () => {
    // The fallback is for a one-row placeholder only. A real list whose value is
    // absent must keep showing nothing rather than adopting another option's name.
    const wrapper = mountDropdown('missing');
    expect(wrapper.get('.dropdown__value').text()).toBe('');
  });

  test('reports its expanded state to assistive technology', async () => {
    const wrapper = mountDropdown();
    const trigger = wrapper.get('[data-dropdown-trigger]');
    expect(trigger.attributes('aria-expanded')).toBe('false');
    expect(trigger.attributes('aria-haspopup')).toBe('listbox');
    await trigger.trigger('click');
    expect(wrapper.get('[data-dropdown-trigger]').attributes('aria-expanded')).toBe('true');
    // The list is labelled by the same name the trigger carries.
    expect(wrapper.get('[role="listbox"]').attributes('aria-label')).toBe('Execution');
  });
});
