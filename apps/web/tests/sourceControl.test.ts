import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import SourceControlView from '../src/components/ide/SourceControlView.vue';
import { useSourceControl } from '../src/composables/useSourceControl';
import type { DesktopBridge, WorkspaceRepositoryStatus } from '../src/services/desktopBridge';

const resources = vi.hoisted(() => ({
  status: undefined as WorkspaceRepositoryStatus | undefined,
  fail: undefined as Error | undefined,
  staged: [] as string[][],
  committed: [] as string[],
}));

vi.mock('../src/services/sourceControl', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/services/sourceControl')>();
  return {
    ...original,
    readRepositoryStatus: vi.fn(async () => {
      if (resources.fail) throw resources.fail;
      return resources.status;
    }),
    stageRepositoryChanges: vi.fn(async (paths: string[]) => {
      resources.staged.push(paths);
      return resources.status!;
    }),
    commitRepositoryChanges: vi.fn(async (message: string) => {
      resources.committed.push(message);
      return resources.status!;
    }),
  };
});

function status(overrides: Partial<WorkspaceRepositoryStatus> = {}): WorkspaceRepositoryStatus {
  return {
    isRepository: true,
    branch: 'feat/source-control',
    changes: [
      { path: 'src/app.py', index: 'M', worktree: ' ', staged: true, status: 'staged' },
      { path: 'src/lib.py', index: ' ', worktree: 'M', staged: false, status: 'modified' },
      { path: 'new.py', index: '?', worktree: '?', staged: false, status: 'untracked' },
    ],
    stagedCount: 1,
    history: [
      { short: 'abc1234', full: 'abc1234567890', subject: 'first commit', author: 'Tester', date: '2026-09-21T00:00:00+08:00' },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  resources.status = status();
  resources.fail = undefined;
  resources.staged = [];
  resources.committed = [];
});

describe('source control controller', () => {
  test('loads the repository and groups the staged and unstaged changes', async () => {
    const controller = useSourceControl();
    await controller.load();

    expect(controller.state.value).toBe('ready');
    expect(controller.branch.value).toBe('feat/source-control');
    expect(controller.changes.value).toHaveLength(3);
    expect(controller.stagedChanges.value.map((change) => change.path)).toEqual(['src/app.py']);
    expect(controller.unstagedChanges.value.map((change) => change.path)).toEqual(['src/lib.py', 'new.py']);
    expect(controller.stagedCount.value).toBe(1);
    expect(controller.history.value[0].subject).toBe('first commit');
  });

  test('requires a message and staged work before it commits, then clears the box', async () => {
    const controller = useSourceControl();
    await controller.load();

    expect(controller.canCommit.value).toBe(false);
    controller.message.value = 'second commit';
    expect(controller.canCommit.value).toBe(true);
    expect(await controller.commit()).toBe(true);
    expect(resources.committed).toEqual(['second commit']);
    expect(controller.message.value).toBe('');
  });

  test('stages the chosen paths through the bridge', async () => {
    const controller = useSourceControl();
    await controller.load();

    await controller.stage(['src/lib.py', 'new.py']);
    expect(resources.staged).toEqual([['src/lib.py', 'new.py']]);
  });

  test('reports a folder that is not a repository instead of failing', async () => {
    resources.status = status({ isRepository: false, branch: '', changes: [], stagedCount: 0, history: [] });
    const controller = useSourceControl();
    await controller.load();

    expect(controller.state.value).toBe('empty');
    expect(controller.isRepository.value).toBe(false);
    expect(controller.error.value).toBeUndefined();
  });

  test('reports the failed load and an empty stream as an error', async () => {
    resources.fail = new Error('git exploded');
    const controller = useSourceControl();
    await controller.load();

    expect(controller.state.value).toBe('error');
    expect(controller.error.value).toBe('git exploded');
  });
});

describe('source control view', () => {
  test('renders the branch, the grouped files, the commit box, and the history', async () => {
    const controller = useSourceControl();
    await controller.load();
    const wrapper = mount(SourceControlView, {
      props: {
        state: controller.state.value,
        branch: controller.branch.value,
        changes: controller.changes.value,
        history: controller.history.value,
        stagedCount: controller.stagedCount.value,
        unstagedChanges: controller.unstagedChanges.value,
        stagedChanges: controller.stagedChanges.value,
        canCommit: true,
      },
    });

    expect(wrapper.get('[data-testid="source-control-branch"]').text()).toContain('feat/source-control');
    expect(wrapper.get('[data-group="staged"]').text()).toContain('src/app.py');
    expect(wrapper.get('[data-group="modified"]').text()).toContain('src/lib.py');
    expect(wrapper.get('[data-group="untracked"]').text()).toContain('new.py');
    expect(wrapper.find('[data-change="new.py"] [data-stage="new.py"]').exists()).toBe(true);
    expect(wrapper.get('[data-testid="source-control-history"]').text()).toContain('first commit');

    await wrapper.get('[data-stage="new.py"]').trigger('click');
    expect(wrapper.emitted('stage')).toEqual([[['new.py']]]);
    await wrapper.get('[data-testid="source-control-message"]').setValue('tidy up');
    expect(wrapper.emitted('update:message')).toEqual([['tidy up']]);
    await wrapper.get('[data-testid="source-control-commit-form"]').trigger('submit');
    expect(wrapper.emitted('commit')).toHaveLength(1);
  });

  test('draws the history as a graph with the HEAD ring and the ref badge', () => {
    const history = [
      {
        short: 'bb0804a', full: 'bb0804a11', subject: 'second commit',
        author: 'Sandkasten', date: '2026-09-22T00:00:00+08:00',
        refs: ['main'], parents: ['aa0704a11'], isHead: true,
        committedAt: Date.now() - 3 * 24 * 60 * 60 * 1000,
      },
      {
        short: 'aa0704a', full: 'aa0704a11', subject: 'first commit',
        author: 'Sandkasten', date: '2026-09-21T00:00:00+08:00',
        refs: [], parents: [], committedAt: Date.now() - 40 * 24 * 60 * 60 * 1000,
      },
    ];
    const wrapper = mount(SourceControlView, {
      props: { state: 'ready', branch: 'main', changes: [], history, stagedCount: 0 },
    });

    const rows = wrapper.findAll('.ide-source-control__commit-entry');
    expect(rows).toHaveLength(2);
    // Every row carries the rail, so the graph is a column of its own.
    expect(wrapper.findAll('[data-testid="source-control-graph"]')).toHaveLength(2);
    // Only the checked-out commit gets the outline, and only it carries a badge.
    expect(rows[0].get('.ide-source-control__graph-dot').classes()).toContain('ide-source-control__graph-dot--head');
    expect(rows[1].get('.ide-source-control__graph-dot').classes()).not.toContain('ide-source-control__graph-dot--head');
    expect(rows[0].get('[data-ref="main"]').text()).toBe('main');
    expect(rows[1].find('[data-ref]').exists()).toBe(false);
    // The age is rendered from the commit time, not from the raw date string.
    expect(rows[0].get('.ide-source-control__commit-meta').text()).toBe('3d');
    // The reference prints the author beside the rail, so the row names it.
    expect(rows[0].get('.ide-source-control__commit-author').text()).toBe('Sandkasten');
  });

  test('explains that source control needs the desktop app in the browser build', () => {
    const wrapper = mount(SourceControlView, { props: { state: 'empty', desktop: false } });
    expect(wrapper.get('[data-testid="source-control-desktop-only"]').text()).toMatch(/desktop/i);
  });

  test('says the folder is not a repository instead of showing an empty change list', () => {
    const wrapper = mount(SourceControlView, { props: { state: 'empty' } });
    expect(wrapper.get('[data-testid="source-control-no-repository"]').text()).toMatch(/git repository/i);
  });
});
