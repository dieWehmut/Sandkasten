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

test('paints a bounded window of a long result list and says there are more', async () => {
  const items = Array.from({ length: 500 }, (_value, index) => ({ id: `shell.cmd-${index}`, label: `cmd-${index}`, kind: 'command' as const }));
  const wrapper = mount(CommandPalette, { attachTo: document.body, props: { open: true, query: '>cmd', items } });
  await nextTick();

  const rows = wrapper.findAll('[data-command]');
  expect(rows.length).toBe(200);
  expect(wrapper.get('[data-testid="palette-more"]').text()).toContain('More matches');
  // The keyboard still walks the painted window, not the whole list.
  await wrapper.get('input').trigger('keydown', { key: 'ArrowUp' });
  expect(wrapper.get('[aria-selected="true"]').attributes('data-command')).toBe('shell.cmd-199');
  await wrapper.get('input').trigger('keydown', { key: 'Enter' });
  expect(wrapper.emitted('select')).toEqual([['shell.cmd-199']]);

  // A short list has no such note.
  await wrapper.setProps({ items: items.slice(0, 3) });
  expect(wrapper.find('[data-testid="palette-more"]').exists()).toBe(false);
  wrapper.unmount();
});
