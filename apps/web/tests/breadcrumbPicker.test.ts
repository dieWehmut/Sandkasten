import { flushPromises, mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { describe, expect, test } from 'vitest';
import IdeBreadcrumbPicker from '../src/components/ide/IdeBreadcrumbPicker.vue';
import IdeBreadcrumbs from '../src/components/ide/IdeBreadcrumbs.vue';
import { siblingEntries } from '../src/editor/breadcrumbs';
import type { WorkspaceTreeNode } from '../src/services/desktopBridge';

const tree: WorkspaceTreeNode[] = [
  { path: 'pkg', name: 'pkg', type: 'directory', children: [{ path: 'pkg/util.py', name: 'util.py', type: 'file' }] },
  { path: 'main.py', name: 'main.py', type: 'file' },
  { path: 'README.md', name: 'README.md', type: 'file' },
];

const entries = siblingEntries(tree, 'pkg');

function picker(overrides: Record<string, unknown> = {}) {
  return mount(IdeBreadcrumbPicker, {
    props: { open: true, entries, activePath: 'pkg', label: 'Breadcrumb picker', ...overrides },
    attachTo: document.body,
  });
}

describe('breadcrumb picker', () => {
  test('drops down the level the step sits in', () => {
    // A step drops down its own level, so the root and a top-level entry both
    // list the workspace root's children, and a nested file lists its folder.
    expect(entries.map((entry) => entry.path)).toEqual(['pkg', 'main.py', 'README.md']);
    expect(siblingEntries(tree, 'main.py').map((entry) => entry.path)).toEqual(['pkg', 'main.py', 'README.md']);
    expect(siblingEntries(tree, '').map((entry) => entry.path)).toEqual(['pkg', 'main.py', 'README.md']);
    expect(siblingEntries(tree, 'pkg/util.py').map((entry) => entry.path)).toEqual(['pkg/util.py']);
    expect(siblingEntries(tree, 'missing/deep/file.py')).toEqual([]);
  });

  test('filters the level and bolds the matching part', async () => {
    const wrapper = picker();
    const filter = wrapper.get('.ide-breadcrumb-picker__input');
    expect(filter.attributes('placeholder')).toBe('Filter this level');
    expect(wrapper.get('[data-path="pkg"]').attributes('aria-current')).toBe('true');

    await filter.setValue('main');
    expect(wrapper.findAll('.ide-breadcrumb-picker__item').map((item) => item.attributes('data-path'))).toEqual(['main.py']);
    expect(wrapper.get('.ide-breadcrumb-picker__name').text()).toBe('main.py');
    expect(wrapper.get('.ide-breadcrumb-picker__name mark').text()).toBe('main');
    await wrapper.get('[data-path="main.py"]').trigger('click');
    expect(wrapper.emitted('select')?.at(-1)).toEqual([{ path: 'main.py', name: 'main.py', kind: 'file' }]);

    await filter.setValue('nothing');
    expect(wrapper.findAll('.ide-breadcrumb-picker__item')).toHaveLength(0);
    expect(wrapper.get('.ide-breadcrumb-picker__empty').text()).toBe('No matches');
    wrapper.unmount();
  });

  test('walks the list with the keyboard and closes on Escape or an outside click', async () => {
    const wrapper = picker();
    const dialog = wrapper.get('[data-testid="breadcrumb-picker"]');
    await dialog.trigger('keydown', { key: 'ArrowDown' });
    expect(wrapper.get('[data-path="main.py"]').attributes('aria-selected')).toBe('true');
    await dialog.trigger('keydown', { key: 'ArrowUp' });
    expect(wrapper.get('[data-path="pkg"]').attributes('aria-selected')).toBe('true');
    await dialog.trigger('keydown', { key: 'Enter' });
    expect(wrapper.emitted('select')?.at(-1)).toEqual([{ path: 'pkg', name: 'pkg', kind: 'directory' }]);

    await dialog.trigger('keydown', { key: 'Escape' });
    expect(wrapper.emitted('close')).toHaveLength(1);

    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    await flushPromises();
    expect(wrapper.emitted('close')).toHaveLength(2);
    wrapper.unmount();
  });

  test('hands focus back to the step that opened it', async () => {
    const wrapper = mount(IdeBreadcrumbs, {
      props: {
        filePath: 'pkg/util.py',
        rootPath: 'C:\\ws',
        tree,
      },
      attachTo: document.body,
    });
    const step = wrapper.get('[data-segment="pkg"]');
    (step.element as HTMLElement).focus();
    await step.trigger('click');
    await flushPromises();
    expect(document.activeElement).toBe(wrapper.get('.ide-breadcrumb-picker__input').element);

    await wrapper.get('[data-testid="breadcrumb-picker"]').trigger('keydown', { key: 'Escape' });
    await nextTick();
    expect(wrapper.find('[data-testid="breadcrumb-picker"]').exists()).toBe(false);
    expect(document.activeElement).toBe(step.element);
    wrapper.unmount();
  });
});