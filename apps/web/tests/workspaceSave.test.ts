import { beforeEach, expect, test, vi } from 'vitest';
import { useWorkspace } from '../src/composables/useWorkspace';

beforeEach(() => localStorage.clear());

test('saving a path keeps a newer edit dirty and serializes overlapping snapshots', async () => {
  const workspace = useWorkspace();
  await workspace.initialize();
  workspace.updateSource('first edit');
  const releases: (() => void)[] = [];
  const writes: string[] = [];
  const originalWrite = workspace.store.write;
  const write = vi.spyOn(workspace.store, 'write').mockImplementation(async (path, source) => {
    writes.push(source);
    await new Promise<void>((resolve) => releases.push(resolve));
    await originalWrite(path, source);
  });
  try {
    const first = workspace.saveActive();
    workspace.updateSource('second edit');
    const second = workspace.saveActive();
    expect(writes).toEqual(['first edit']);
    releases.shift()?.();
    await first;
    expect(workspace.activeFile.value?.dirty).toBe(true);
    await Promise.resolve();
    expect(writes).toEqual(['first edit', 'second edit']);
    releases.shift()?.();
    await second;
    expect(workspace.activeFile.value?.dirty).toBe(false);
    expect(await workspace.store.read(workspace.activePath.value)).toBe('second edit');
  } finally { write.mockRestore(); }
});
