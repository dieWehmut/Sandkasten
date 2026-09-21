// One repository state over the opened folder. The controller owns the status,
// the commit draft, and the busy flag so the view stays presentational.
import { computed, ref, type ComputedRef, type Ref } from 'vue';
import type { WorkspaceChange, WorkspaceCommit, WorkspaceRepositoryStatus } from '../services/desktopBridge';
import {
  SOURCE_CONTROL_NEEDS_DESKTOP,
  commitRepositoryChanges,
  readRepositoryStatus,
  stageRepositoryChanges,
} from '../services/sourceControl';

export type SourceControlState = 'idle' | 'loading' | 'ready' | 'empty' | 'error';

export interface SourceControlController {
  state: Ref<SourceControlState>;
  branch: Ref<string>;
  changes: Ref<WorkspaceChange[]>;
  history: Ref<WorkspaceCommit[]>;
  stagedCount: Ref<number>;
  message: Ref<string>;
  error: Ref<string | undefined>;
  busy: Ref<boolean>;
  isRepository: Ref<boolean>;
  canCommit: ComputedRef<boolean>;
  unstagedChanges: ComputedRef<WorkspaceChange[]>;
  stagedChanges: ComputedRef<WorkspaceChange[]>;
  load(): Promise<void>;
  stage(paths: string[]): Promise<void>;
  commit(): Promise<boolean>;
  clearMessage(): void;
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// A missing bridge is reported as a state rather than thrown at mount time, so
// the browser build renders the desktop-only message instead of an error.
function needsDesktop(error: unknown): boolean {
  return messageFrom(error) === SOURCE_CONTROL_NEEDS_DESKTOP;
}

export function useSourceControl(): SourceControlController {
  const state = ref<SourceControlState>('idle');
  const isRepository = ref(false);
  const branch = ref('');
  const changes = ref<WorkspaceChange[]>([]);
  const history = ref<WorkspaceCommit[]>([]);
  const stagedCount = ref(0);
  const message = ref('');
  const error = ref<string>();
  const busy = ref(false);
  let generation = 0;

  // Staged work is listed first, then the working tree, matching the reference.
  const stagedChanges = computed(() => changes.value.filter((change) => change.staged));
  const unstagedChanges = computed(() => changes.value.filter((change) => !change.staged));
  const canCommit = computed(() => Boolean(message.value.trim()) && stagedCount.value > 0 && !busy.value);

  function apply(status: WorkspaceRepositoryStatus): void {
    isRepository.value = status.isRepository;
    branch.value = status.branch;
    changes.value = status.changes;
    history.value = status.history;
    stagedCount.value = status.stagedCount;
    state.value = status.isRepository ? 'ready' : 'empty';
  }

  async function load(): Promise<void> {
    const current = ++generation;
    state.value = 'loading';
    error.value = undefined;
    try {
      const status = await readRepositoryStatus();
      if (current !== generation) return;
      apply(status);
    } catch (cause) {
      if (current !== generation) return;
      isRepository.value = false;
      branch.value = '';
      changes.value = [];
      history.value = [];
      stagedCount.value = 0;
      error.value = messageFrom(cause);
      state.value = needsDesktop(cause) ? 'empty' : 'error';
    }
  }

  async function stage(paths: string[]): Promise<void> {
    if (!paths.length) return;
    busy.value = true;
    error.value = undefined;
    try {
      apply(await stageRepositoryChanges(paths));
    } catch (cause) {
      error.value = messageFrom(cause);
    } finally {
      busy.value = false;
    }
  }

  async function commit(): Promise<boolean> {
    if (!canCommit.value) return false;
    busy.value = true;
    error.value = undefined;
    try {
      apply(await commitRepositoryChanges(message.value.trim()));
      message.value = '';
      return true;
    } catch (cause) {
      error.value = messageFrom(cause);
      return false;
    } finally {
      busy.value = false;
    }
  }

  function clearMessage(): void {
    message.value = '';
  }

  return {
    state, branch, changes, history, stagedCount, message, error, busy, isRepository,
    canCommit, stagedChanges, unstagedChanges, load, stage, commit, clearMessage,
  };
}
