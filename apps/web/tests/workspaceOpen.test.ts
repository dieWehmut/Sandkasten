import { beforeEach, expect, test, vi } from 'vitest';
import { useWorkspace } from '../src/composables/useWorkspace';

beforeEach(() => localStorage.clear());

test('double-clicking a file during its read opens one tab and preserves edits made before the second read completes', async () => {
  const workspace = useWorkspace();
  await workspace.initialize();
  const releases: ((source: string) => void)[] = [];
  const read = vi.spyOn(workspace.store, 'read').mockImplementation(() => new Promise<string>((resolve) => releases.push(resolve)));
  try {
    const first = workspace.openFile('nested/settings.json');
    const second = workspace.openFile('nested/settings.json');
    releases[0]('{"original":true}');
    await first;
    workspace.updateSource('{"edited":true}');
    releases[1]('{"original":true}');
    await second;
    const tabs = workspace.files.value.filter((file) => file.path === 'nested/settings.json');
    expect(tabs).toHaveLength(1);
    expect(tabs[0]).toMatchObject({ source: '{"edited":true}', dirty: true });
    expect(workspace.activePath.value).toBe('nested/settings.json');
  } finally { read.mockRestore(); }
});
