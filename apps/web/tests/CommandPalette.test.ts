import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { afterEach, expect, test } from 'vitest';
import CommandPalette from '../src/components/CommandPalette.vue';

afterEach(() => { document.body.innerHTML = ''; });

test('focuses the combobox, navigates results, executes the selected row, and restores focus', async () => {
  const opener = document.createElement('button');
  document.body.append(opener);
  opener.focus();
  const wrapper = mount(CommandPalette, { attachTo: document.body, props: {
    open: true, query: '', items: [
      { id: 'main.py', label: 'main.py', kind: 'file' },
      { id: 'file.save', label: 'Save File', kind: 'command', accelerator: 'Ctrl+S' },
    ],
  } });
  await nextTick();
  const input = wrapper.get('[role="combobox"]');
  expect(document.activeElement).toBe(input.element);
  expect(wrapper.get('[role="dialog"]').attributes('aria-modal')).toBe('true');
  await input.trigger('keydown', { key: 'ArrowDown' });
  expect(wrapper.get('[aria-selected="true"]').text()).toContain('Save File');
  expect(input.attributes('aria-activedescendant')).toBe(wrapper.get('[aria-selected="true"]').attributes('id'));
  await input.trigger('keydown', { key: 'Tab' });
  expect(document.activeElement).toBe(input.element);
  await input.trigger('keydown', { key: 'Enter' });
  expect(wrapper.emitted('select')).toEqual([['file.save']]);
  await wrapper.setProps({ open: false });
  await nextTick();
  expect(document.activeElement).toBe(opener);
  wrapper.unmount();
});

test('closes with Escape or an outside press and resets selection when the query changes', async () => {
  const wrapper = mount(CommandPalette, { attachTo: document.body, props: {
    open: true, query: '', items: [{ id: 'a', label: 'a', kind: 'file' }, { id: 'b', label: 'b', kind: 'file' }],
  } });
  await nextTick();
  await wrapper.get('input').trigger('keydown', { key: 'ArrowUp' });
  expect(wrapper.get('[aria-selected="true"]').text()).toBe('b');
  await wrapper.setProps({ query: 'a', items: [{ id: 'a', label: 'a', kind: 'file' }] });
  expect(wrapper.get('[aria-selected="true"]').text()).toBe('a');
  await wrapper.get('input').trigger('keydown', { key: 'Escape' });
  expect(wrapper.emitted('close')).toHaveLength(1);
  document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
  expect(wrapper.emitted('close')).toHaveLength(2);
  wrapper.unmount();
});
