import { mount, flushPromises } from '@vue/test-utils';
import { defineComponent, ref } from 'vue';
import { afterEach, expect, test, vi } from 'vitest';
import { useAutoSave } from '../src/composables/useAutoSave';
import type { WorkspaceFile } from '../src/composables/useWorkspace';
import type { FileSettings } from '../src/state/editorSettings';

const file = (path: string, source = 'old'): WorkspaceFile => ({ path, name: path, source, language: 'python', dirty: true });
afterEach(() => vi.useRealTimers());
function fixture(mode: FileSettings['autoSave'] = 'afterDelay') {
  const files = ref([file('a.py')]);
  const settings = ref<FileSettings>({ autoSave: mode, autoSaveDelay: 300 });
  const saved = vi.fn(async (_path: string) => true);
  const wrapper = mount(defineComponent({
    setup() { useAutoSave({ files, settings, saveFile: saved }); return {}; },
    template: '<div><div class="source-editor"><input data-editor /></div><button data-outside>Outside</button></div>',
  }), { attachTo: document.body });
  return { files, settings, saved, wrapper };
}

test('automatic saving debounces each edited path and preserves the identity after a tab change', async () => {
  vi.useFakeTimers();
  const { files, saved, wrapper } = fixture();
  try {
    await vi.advanceTimersByTimeAsync(200);
    files.value = [file('a.py', 'new'), file('b.py', 'second')];
    await flushPromises();
    await vi.advanceTimersByTimeAsync(299);
    expect(saved).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(saved.mock.calls).toEqual([['a.py'], ['b.py']]);
  } finally { wrapper.unmount(); }
});

test('turning automatic saving off cancels a pending save; enabling it schedules dirty files', async () => {
  vi.useFakeTimers();
  const { settings, saved, wrapper } = fixture();
  try {
    settings.value.autoSave = 'off';
    await flushPromises();
    await vi.advanceTimersByTimeAsync(1000);
    expect(saved).not.toHaveBeenCalled();
    settings.value.autoSave = 'afterDelay';
    await flushPromises();
    await vi.advanceTimersByTimeAsync(300);
    expect(saved).toHaveBeenCalledWith('a.py');
  } finally { wrapper.unmount(); }
});

test('focus saving only fires when focus leaves the source editor and also handles window blur', async () => {
  const { saved, wrapper } = fixture('onFocusChange');
  try {
    const input = wrapper.get('[data-editor]').element as HTMLInputElement;
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: input }));
    expect(saved).not.toHaveBeenCalled();
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: wrapper.get('[data-outside]').element }));
    await flushPromises();
    expect(saved).toHaveBeenCalledWith('a.py');
    window.dispatchEvent(new Event('blur'));
    await flushPromises();
    expect(saved).toHaveBeenCalledTimes(2);
  } finally { wrapper.unmount(); }
});
