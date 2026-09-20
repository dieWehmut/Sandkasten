import { computed, effectScope, ref } from 'vue';
import { describe, expect, test } from 'vitest';
import { useEditorHistory } from '../src/composables/useEditorHistory';

function harness(limit = 50) {
  const active = ref('a.py');
  const paths = ref(['a.py', 'b.py', 'c.py', 'd.py']);
  const scope = effectScope();
  const history = scope.run(() => useEditorHistory({
    activePath: active, paths: computed(() => paths.value), limit,
    openFile: async (path) => { active.value = path; },
  }))!;
  return { active, paths, history, stop: () => scope.stop() };
}

describe('editor navigation history', () => {
  test('reopens closed editors, preserves forward steps, and branches after opening another file', async () => {
    const app = harness();
    expect(app.history.canBack.value).toBe(false);
    app.active.value = 'b.py';
    app.active.value = 'c.py';
    await app.history.back();
    expect(app.active.value).toBe('b.py');
    expect(app.history.canForward.value).toBe(true);
    await app.history.forward();
    expect(app.active.value).toBe('c.py');
    app.active.value = ''; // Closing all tabs keeps files available to reopen.
    await app.history.back();
    expect(app.active.value).toBe('b.py');
    app.active.value = 'd.py';
    expect(app.history.canForward.value).toBe(false);
    expect(app.history.recentPaths.value).toEqual(['d.py', 'b.py', 'c.py', 'a.py']);
    app.stop();
  });

  test('bounds history, ignores repeated paths, and prunes removed files', async () => {
    const app = harness(3);
    for (const path of ['b.py', 'c.py', 'c.py', 'd.py']) app.active.value = path;
    await app.history.back();
    await app.history.back();
    expect(app.active.value).toBe('b.py');
    expect(app.history.canBack.value).toBe(false);
    app.paths.value = ['b.py', 'd.py'];
    await app.history.forward();
    expect(app.active.value).toBe('d.py');
    expect(app.history.recentPaths.value).not.toContain('c.py');
    app.history.reset();
    expect(app.history.canBack.value).toBe(false);
    expect(app.history.canForward.value).toBe(false);
    expect(app.history.recentPaths.value).toEqual([]);
    app.stop();
  });
});
