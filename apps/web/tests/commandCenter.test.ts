import { computed, ref } from 'vue';
import { describe, expect, test } from 'vitest';
import { useCommandCenter } from '../src/composables/useCommandCenter';
import { createTranslator } from '../src/i18n/locale';

describe('command center results', () => {
  test('searches workspace paths and lists recent files first without duplicate entries', () => {
    const center = useCommandCenter({
      paths: computed(() => ['src/main.py', 'README.md', 'tests/main.test.py']),
      recentPaths: computed(() => ['README.md', 'src/main.py']),
      commands: computed(() => []), t: createTranslator('en'),
    });
    center.openPalette();
    expect(center.items.value.filter((item) => item.kind === 'file').map((item) => item.id))
      .toEqual(['README.md', 'src/main.py', 'tests/main.test.py']);
    center.query.value = 'MAIN';
    expect(center.items.value.map((item) => item.id)).toEqual(['src/main.py', 'tests/main.test.py']);
    center.query.value = 'unknown';
    expect(center.items.value).toEqual([]);
  });

  test('command mode excludes unavailable operations and exposes real accelerators', () => {
    const runnable = ref(false);
    const center = useCommandCenter({
      paths: computed(() => ['main.py']), recentPaths: computed(() => []), t: createTranslator('en'),
      commands: computed(() => [
        { id: 'file.save', label: 'Save File', accelerator: 'Ctrl+S', execute: () => {} },
        { id: 'run.start', label: 'Run Active File', accelerator: 'F5', enabled: runnable.value, execute: () => {} },
      ]),
    });
    center.openPalette('commands');
    expect(center.query.value).toBe('>');
    expect(center.items.value.map((item) => item.id)).toEqual(['file.save']);
    expect(center.items.value[0].accelerator).toBe('Ctrl+S');
    runnable.value = true;
    center.query.value = '>run';
    expect(center.items.value.map((item) => item.id)).toEqual(['run.start']);
    center.close();
    expect(center.open.value).toBe(false);
  });
});
