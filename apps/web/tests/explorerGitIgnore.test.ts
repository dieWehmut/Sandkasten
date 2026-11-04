import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, test } from 'vitest';
import WorkspaceExplorer from '../src/components/ide/WorkspaceExplorer.vue';
import type { WorkspaceTreeNode } from '../src/services/desktopBridge';

// The reference's Explorer keeps .gitignore matches in the tree by default and
// tints them with `gitDecoration.ignoredResourceForeground`; only
// `explorer.excludeGitIgnore` (default false) removes them. The tree marks the
// nodes, and this component is what shows the mark.
const tree: WorkspaceTreeNode[] = [
  {
    path: 'src',
    name: 'src',
    type: 'directory',
    children: [
      { path: 'src/app.py', name: 'app.py', type: 'file' },
      { path: 'src/trace.log', name: 'trace.log', type: 'file', ignored: true },
    ],
  },
  { path: 'main.py', name: 'main.py', type: 'file' },
  { path: 'debug.log', name: 'debug.log', type: 'file', ignored: true },
];

function mountExplorer() {
  return mount(WorkspaceExplorer, {
    props: {
      files: [{ path: 'main.py', name: 'main.py', dirty: false }],
      activePath: 'main.py',
      tree,
      root: { path: 'C:/ws', name: 'ws' },
      workspaceKind: 'desktop',
      dirtyPaths: [],
    },
    attachTo: document.body,
  });
}

describe('explorer marks git-ignored entries', () => {
  test('an ignored file keeps its row and carries the mark', async () => {
    const wrapper = mountExplorer();
    await flushPromises();
    const row = wrapper.get('[data-path="debug.log"]');
    // It is present — the default does not hide it.
    const fileRow = row.get('.ide-tree__row');
    expect(fileRow.classes()).toContain('ide-tree__row--ignored');
    expect(fileRow.attributes('data-ignored')).toBe('true');
    // The tooltip says why, in the current locale.
    expect(fileRow.attributes('title')).toBe('Ignored by .gitignore');
  });

  test('an unignored file carries no mark', async () => {
    const wrapper = mountExplorer();
    await flushPromises();
    const row = wrapper.get('[data-path="main.py"]').get('.ide-tree__row');
    expect(row.classes()).not.toContain('ide-tree__row--ignored');
    expect(row.attributes('data-ignored')).toBeUndefined();
    expect(row.attributes('title')).toBeUndefined();
  });

  test('the mark reaches nested entries too', async () => {
    const wrapper = mountExplorer();
    await flushPromises();
    const row = wrapper.get('[data-path="src/trace.log"]').get('.ide-tree__row');
    expect(row.classes()).toContain('ide-tree__row--ignored');
    // Its sibling is untouched.
    expect(wrapper.get('[data-path="src/app.py"]').get('.ide-tree__row').attributes('data-ignored')).toBeUndefined();
  });

  test('the tint token is defined for both themes', async () => {
    // The rows rely on `--git-ignored` existing in both palettes; a missing token
    // would leave the mark invisible rather than failing loudly.
    const tokens = await import('node:fs/promises').then((fs) => fs.readFile('src/styles/tokens.css', 'utf8'));
    const occurrences = tokens.match(/--git-ignored:\s*#([0-9a-f]{6})/gi) ?? [];
    expect(occurrences).toHaveLength(2);
    // The reference's own values: #8E8E90 light, #8C8C8C dark.
    expect(occurrences.join(' ').toLowerCase()).toContain('#8e8e90');
    expect(occurrences.join(' ').toLowerCase()).toContain('#8c8c8c');
  });
});
