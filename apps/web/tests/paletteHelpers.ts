import { flushPromises, type VueWrapper } from '@vue/test-utils';

/** Drive the actual palette rather than bypassing the application's command wiring. */
export async function runPaletteCommand(wrapper: VueWrapper, id: string): Promise<void> {
  await wrapper.get('[data-action="quick-open"]').trigger('click');
  await wrapper.get('[role="combobox"]').setValue('>');
  await wrapper.get(`[data-command="${id}"]`).trigger('click');
  await flushPromises();
}
