import { flushPromises, mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { describe, expect, test, vi } from 'vitest';
import ContextMenu from '../src/components/ContextMenu.vue';
import { menuSeparator, type ContextMenuEntry } from '../src/components/contextMenu';
import { editorMenuEntries } from '../src/editor/editorMenu';
import { createTranslator } from '../src/i18n/locale';

const entries: ContextMenuEntry[] = [
  { kind: 'item', id: 'cut', label: 'Cut', keybinding: 'Ctrl+X' },
  { kind: 'item', id: 'copy', label: 'Copy', keybinding: 'Ctrl+C', disabled: true },
  menuSeparator(),
  { kind: 'item', id: 'selectAll', label: 'Select All', keybinding: 'Ctrl+A' },
];

function menu() {
  return mount(ContextMenu, {
    props: { open: true, x: 40, y: 60, entries, label: 'Editor actions' },
    attachTo: document.body,
  });
}

describe('context menu', () => {
  test('renders the items, the separator and the accelerators', () => {
    const wrapper = menu();
    expect(wrapper.get('[data-testid="context-menu"]').attributes('role')).toBe('menu');
    expect(wrapper.get('[data-testid="context-menu"]').attributes('aria-label')).toBe('Editor actions');
    expect(wrapper.findAll('.context-menu__item').map((item) => item.find('.context-menu__label').text()))
      .toEqual(['Cut', 'Copy', 'Select All']);
    expect(wrapper.findAll('.context-menu__keybinding').map((key) => key.text())).toEqual(['Ctrl+X', 'Ctrl+C', 'Ctrl+A']);
    expect(wrapper.findAll('.context-menu__separator')).toHaveLength(1);
    expect(wrapper.get('[data-action="context-menu-copy"]').attributes('disabled')).toBeDefined();
    wrapper.unmount();
  });

  test('walks only the enabled items and reports the choice', async () => {
    const wrapper = menu();
    // The disabled row is skipped by the arrow keys and cannot be chosen.
    await wrapper.get('[data-testid="context-menu"]').trigger('keydown', { key: 'ArrowDown' });
    expect(wrapper.get('[data-testid="context-menu"]').attributes('aria-activedescendant')).toBe('context-menu-3');
    await wrapper.get('[data-testid="context-menu"]').trigger('keydown', { key: 'ArrowDown' });
    expect(wrapper.get('[data-testid="context-menu"]').attributes('aria-activedescendant')).toBe('context-menu-0');
    await wrapper.get('[data-testid="context-menu"]').trigger('keydown', { key: 'End' });
    expect(wrapper.get('[data-testid="context-menu"]').attributes('aria-activedescendant')).toBe('context-menu-3');
    await wrapper.get('[data-testid="context-menu"]').trigger('keydown', { key: 'Home' });
    expect(wrapper.get('[data-testid="context-menu"]').attributes('aria-activedescendant')).toBe('context-menu-0');

    await wrapper.get('[data-testid="context-menu"]').trigger('keydown', { key: 'Enter' });
    expect(wrapper.emitted('select')).toEqual([['cut']]);

    await wrapper.get('[data-action="context-menu-selectAll"]').trigger('click');
    expect(wrapper.emitted('select')?.at(-1)).toEqual(['selectAll']);
    // A disabled row emits nothing.
    await wrapper.get('[data-action="context-menu-copy"]').trigger('click');
    expect(wrapper.emitted('select')).toHaveLength(2);
    wrapper.unmount();
  });

  test('closes on Escape and on a click outside, but not on a click inside', async () => {
    const wrapper = menu();
    await wrapper.get('[data-testid="context-menu"]').trigger('keydown', { key: 'Escape' });
    expect(wrapper.emitted('close')).toHaveLength(1);

    await wrapper.get('.context-menu__item').trigger('pointerdown');
    expect(wrapper.emitted('close')).toHaveLength(1);
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    await nextTick();
    expect(wrapper.emitted('close')).toHaveLength(2);
    wrapper.unmount();
  });

  test('opens from the keyboard the way the reference does', async () => {
    const { default: SourceEditor } = await import('../src/components/SourceEditor.vue');
    const wrapper = mount(SourceEditor, { props: { modelValue: 'alpha\nbeta\n', language: 'python' }, attachTo: document.body });
    const view = wrapper.vm.editorView as import('@codemirror/view').EditorView;
    view.dispatch({ selection: { anchor: 2 } });
    view.focus();

    // Shift+F10 (and the dedicated menu key) reach the same menu as right-click.
    const cmContent = wrapper.get('.cm-content');
    await cmContent.trigger('keydown', { key: 'F10', shiftKey: true });
    expect(wrapper.find('[data-testid="context-menu"]').exists()).toBe(true);
    await wrapper.get('[data-testid="context-menu"]').trigger('keydown', { key: 'Escape' });
    await nextTick();
    expect(wrapper.find('[data-testid="context-menu"]').exists()).toBe(false);

    await cmContent.trigger('keydown', { key: 'ContextMenu' });
    const menu = wrapper.get('[data-testid="context-menu"]');
    // The caret is inside the first word, so the selection actions stay disabled
    // while the document-wide ones are available.
    expect(menu.get('[data-action="context-menu-selectAll"]').attributes('disabled')).toBeUndefined();
    expect(menu.get('[data-action="context-menu-copy"]').attributes('disabled')).toBeDefined();
    wrapper.unmount();
  });

  test('hands focus back to the editor when it closes', async () => {
    const { default: SourceEditor } = await import('../src/components/SourceEditor.vue');
    const wrapper = mount(SourceEditor, { props: { modelValue: 'alpha\nbeta\n', language: 'python' }, attachTo: document.body });
    await wrapper.get('[data-testid="source-editor"]').trigger('contextmenu', { clientX: 20, clientY: 20 });
    const dialog = wrapper.get('[data-testid="context-menu"]');
    expect(document.activeElement).toBe(dialog.element);

    await dialog.trigger('keydown', { key: 'Escape' });
    await nextTick();
    expect(wrapper.find('[data-testid="context-menu"]').exists()).toBe(false);
    // Focus returns to the editor rather than falling back to the document.
    expect((document.activeElement as HTMLElement)?.className).toContain('cm-content');
    wrapper.unmount();
  });

  test('clamps itself into the viewport on open', async () => {
    const wrapper = mount(ContextMenu, {
      props: { open: false, x: 5000, y: 5000, entries, label: 'Editor actions' },
      attachTo: document.body,
    });
    await wrapper.setProps({ open: true });
    // The widget measures itself before it shows, so it needs the promise queue.
    await flushPromises();
    const style = wrapper.get('[data-testid="context-menu"]').attributes('style') ?? '';
    const left = Number(/left:\s*(\d+)px/.exec(style)?.[1]);
    const top = Number(/top:\s*(\d+)px/.exec(style)?.[1]);
    // jsdom reports a zero-sized box, so both offsets clamp to the 4 px margin.
    expect(left).toBeLessThanOrEqual(Math.max(4, window.innerWidth - 4));
    expect(top).toBeLessThanOrEqual(Math.max(4, window.innerHeight - 4));
    expect(wrapper.get('[data-testid="context-menu"]').classes()).toContain('context-menu--placed');
    wrapper.unmount();
  });
});

describe('editor menu entries', () => {
  const t = createTranslator('en');

  test('mirrors the editor commands and their availability', () => {
    const entries = editorMenuEntries(t, { hasSelection: false, canPaste: true, canUndo: false, canRedo: false, modifier: 'Ctrl' });
    expect(entries.filter((entry) => entry.kind === 'item').map((entry) => entry.id))
      .toEqual(['cut', 'copy', 'paste', 'selectAll', 'undo', 'redo', 'find']);
    const byId = (id: string) => entries.find((entry) => entry.kind === 'item' && entry.id === id);
    expect(byId('cut')).toMatchObject({ label: 'Cut', keybinding: 'Ctrl+X', disabled: true });
    expect(byId('copy')).toMatchObject({ disabled: true });
    expect(byId('paste')).toMatchObject({ disabled: false, keybinding: 'Ctrl+V' });
    expect(byId('undo')).toMatchObject({ disabled: true, keybinding: 'Ctrl+Z' });
    expect(byId('redo')).toMatchObject({ disabled: true, keybinding: 'Ctrl+Shift+Z' });
    expect(byId('find')).toMatchObject({ keybinding: 'Ctrl+F' });
    expect(byId('find')?.kind === 'item' ? byId('find')?.disabled : 'missing').toBeUndefined();
    expect(entries.filter((entry) => entry.kind === 'separator')).toHaveLength(3);

    const mac = editorMenuEntries(t, { hasSelection: true, canPaste: false, canUndo: true, canRedo: true, modifier: 'Cmd' });
    const macById = (id: string) => mac.find((entry) => entry.kind === 'item' && entry.id === id);
    expect(macById('cut')).toMatchObject({ disabled: false, keybinding: 'Cmd+X' });
    expect(macById('paste')).toMatchObject({ disabled: true });
    expect(macById('undo')).toMatchObject({ disabled: false });
  });
});

describe('source editor menu wiring', () => {
  test('opening the menu lists the editor actions and runs the chosen one', async () => {
    vi.resetModules();
    const { default: SourceEditor } = await import('../src/components/SourceEditor.vue');
    const wrapper = mount(SourceEditor, { props: { modelValue: 'alpha\nbeta\n', language: 'python' }, attachTo: document.body });
    expect(wrapper.find('[data-testid="context-menu"]').exists()).toBe(false);

    await wrapper.get('[data-testid="source-editor"]').trigger('contextmenu', { clientX: 30, clientY: 30 });
    const menu = wrapper.get('[data-testid="context-menu"]');
    expect(menu.findAll('.context-menu__item').map((item) => item.find('.context-menu__label').text()))
      .toEqual(['Cut', 'Copy', 'Paste', 'Select All', 'Undo', 'Redo', 'Find']);

    // Select All through the menu selects the whole document.
    await wrapper.get('[data-action="context-menu-selectAll"]').trigger('click');
    const view = wrapper.vm.editorView as import('@codemirror/view').EditorView;
    expect(view.state.selection.main.to).toBe(view.state.doc.length);
    expect(wrapper.find('[data-testid="context-menu"]').exists()).toBe(false);
    wrapper.unmount();
  });
});