import { mount } from '@vue/test-utils';
import { describe, expect, test } from 'vitest';
import DiscardChangesDialog from '../src/components/DiscardChangesDialog.vue';
import { createTranslator } from '../src/i18n/locale';

describe('discard changes dialog', () => {
  test('names the file and asks before dropping unsaved edits', () => {
    // Closing a dirty file used to drop its edits without a word; reopening showed
    // the stored source again. The dialog is the guard in front of that.
    const wrapper = mount(DiscardChangesDialog, {
      props: { open: true, file: 'main.py', t: createTranslator('en') },
    });
    expect(wrapper.get('[role="alertdialog"]').attributes('aria-modal')).toBe('true');
    expect(wrapper.get('#discard-title').text()).toBe('Discard unsaved changes?');
    expect(wrapper.get('[data-testid="discard-file"]').text()).toBe('main.py');
    expect(wrapper.get('[data-action="discard-cancel"]').text()).toBe('Keep editing');
    expect(wrapper.get('[data-action="discard-confirm"]').text()).toBe('Discard and close');
  });

  test('stays out of the way when no file is pending', () => {
    const wrapper = mount(DiscardChangesDialog, {
      props: { open: false, file: '', t: createTranslator('en') },
    });
    expect(wrapper.find('[data-testid="discard-dialog"]').exists()).toBe(false);
  });

  test('emits discard and cancel from the matching buttons and Escape', async () => {
    const wrapper = mount(DiscardChangesDialog, {
      props: { open: true, file: 'main.py', t: createTranslator('en') },
    });
    await wrapper.get('[data-action="discard-confirm"]').trigger('click');
    expect(wrapper.emitted('discard')).toHaveLength(1);
    await wrapper.get('[data-action="discard-cancel"]').trigger('click');
    expect(wrapper.emitted('cancel')).toHaveLength(1);
    await wrapper.get('[data-testid="discard-dialog"]').trigger('keydown', { key: 'Escape' });
    expect(wrapper.emitted('cancel')).toHaveLength(2);
  });

  test('translates its copy into Chinese', () => {
    const wrapper = mount(DiscardChangesDialog, {
      props: { open: true, file: 'main.py', t: createTranslator('zh-CN') },
    });
    expect(wrapper.get('#discard-title').text()).toBe('放弃未保存的更改？');
    expect(wrapper.get('[data-action="discard-confirm"]').text()).toBe('放弃并关闭');
    expect(wrapper.get('[data-action="discard-cancel"]').text()).toBe('继续编辑');
  });
});
