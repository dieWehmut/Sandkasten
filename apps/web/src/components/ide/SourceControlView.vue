<script setup lang="ts">
import { GitBranch, GitCommitHorizontal, RefreshCw } from '@lucide/vue';
import type { WorkspaceChange, WorkspaceCommit } from '../../services/desktopBridge';
import type { SourceControlState } from '../../composables/useSourceControl';
import { useTranslation } from '../../i18n/useTranslation';

// The view renders the repository the controller loaded and raises the two
// actions it offers. It never runs git itself and never invents a change list.
const props = withDefaults(defineProps<{
  state: SourceControlState;
  branch?: string;
  changes?: WorkspaceChange[];
  history?: WorkspaceCommit[];
  stagedCount?: number;
  unstagedChanges?: WorkspaceChange[];
  stagedChanges?: WorkspaceChange[];
  message?: string;
  error?: string;
  desktop?: boolean;
  busy?: boolean;
  canCommit?: boolean;
}>(), {
  branch: '', changes: () => [], history: () => [], stagedCount: 0,
  unstagedChanges: () => [], stagedChanges: () => [], message: '',
  desktop: true, busy: false, canCommit: false,
});

const emit = defineEmits<{
  'update:message': [value: string];
  refresh: [];
  stage: [paths: string[]];
  commit: [];
}>();

const t = useTranslation();

// The reference groups the changed files by their state, so the view does too;
// every group is labelled and each entry names its status letter.
const GROUPS: ReadonlyArray<{ key: string; statuses: ReadonlyArray<WorkspaceChange['status']> }> = [
  { key: 'staged', statuses: ['staged', 'added'] },
  { key: 'modified', statuses: ['modified'] },
  { key: 'untracked', statuses: ['untracked'] },
  { key: 'deleted', statuses: ['deleted', 'renamed', 'conflicted'] },
];

function groupLabel(key: string): string {
  return t(`ide.sourceControl.group.${key}` as 'ide.sourceControl.group.staged');
}

function statusLetter(change: WorkspaceChange): string {
  // A staged change reports its index letter; an unstaged one its work tree
  // letter. '?' and ' ' would read as blanks, so they become the reference's
  // own letters.
  const index = change.index?.trim();
  const worktree = change.worktree?.trim();
  if (index === '?' || worktree === '?') return 'U';
  return index || worktree || 'M';
}
</script>

<template>
  <section class="ide-source-control" data-testid="source-control" :aria-label="t('ide.sourceControl.label')">
    <p v-if="!desktop" class="empty-state ide-source-control__hint" data-testid="source-control-desktop-only">
      {{ t('ide.sourceControl.desktopOnly') }}
    </p>
    <p v-else-if="error" class="ide-explorer__error" role="alert" data-testid="source-control-error">{{ error }}</p>
    <p v-else-if="state === 'loading'" class="empty-state ide-source-control__hint" data-testid="source-control-loading">
      {{ t('ide.sourceControl.loading') }}
    </p>
    <template v-else-if="state === 'empty'">
      <p class="empty-state ide-source-control__hint" data-testid="source-control-no-repository">
        {{ t('ide.sourceControl.noRepository') }}
      </p>
    </template>
    <template v-else>
      <div class="ide-source-control__head">
        <span class="ide-source-control__branch" data-testid="source-control-branch">
          <GitBranch :size="13" aria-hidden="true" />
          {{ branch }}
        </span>
        <span class="ide-source-control__count" data-testid="source-control-count">
          {{ stagedCount }} {{ t('ide.sourceControl.stagedSuffix') }}
        </span>
        <button
          type="button"
          class="ide-source-control__refresh"
          data-action="source-control-refresh"
          :aria-label="t('ide.sourceControl.refresh')"
          :title="t('ide.sourceControl.refresh')"
          :disabled="busy"
          @click="emit('refresh')"
        >
          <RefreshCw :size="13" aria-hidden="true" />
        </button>
      </div>

      <form class="ide-source-control__commit" data-testid="source-control-commit-form" @submit.prevent="emit('commit')">
        <textarea
          :value="message"
          data-testid="source-control-message"
          class="ide-source-control__message"
          rows="3"
          name="commitMessage"
          autocomplete="off"
          spellcheck="false"
          :placeholder="t('ide.sourceControl.messagePlaceholder')"
          :aria-label="t('ide.sourceControl.message')"
          :disabled="busy"
          @input="emit('update:message', ($event.target as HTMLTextAreaElement).value)"
        />
        <button
          type="submit"
          class="ide-source-control__action"
          data-action="source-control-commit"
          :disabled="!canCommit"
        >
          <GitCommitHorizontal :size="14" aria-hidden="true" />
          {{ t('ide.sourceControl.commit') }}
        </button>
      </form>

      <p v-if="!changes.length" class="empty-state ide-source-control__hint" data-testid="source-control-clean">
        {{ t('ide.sourceControl.clean') }}
      </p>
      <template v-else>
        <div v-for="group in GROUPS" :key="group.key" class="ide-source-control__group" :data-group="group.key">
          <template v-if="changes.filter((change) => group.statuses.includes(change.status)).length">
            <p class="ide-source-control__group-title">{{ groupLabel(group.key) }}</p>
            <ul class="ide-source-control__files" :aria-label="groupLabel(group.key)">
              <li
                v-for="change in changes.filter((entry) => group.statuses.includes(entry.status))"
                :key="change.path"
                class="ide-source-control__file"
                :data-change="change.path"
              >
                <button
                  v-if="!change.staged"
                  type="button"
                  class="ide-source-control__file-name"
                  :data-stage="change.path"
                  :title="t('ide.sourceControl.stageFile')"
                  :disabled="busy"
                  @click="emit('stage', [change.path])"
                >
                  <span class="ide-source-control__letter">{{ statusLetter(change) }}</span>
                  <span class="ide-source-control__path">{{ change.path }}</span>
                </button>
                <span v-else class="ide-source-control__file-name ide-source-control__file-name--static">
                  <span class="ide-source-control__letter">{{ statusLetter(change) }}</span>
                  <span class="ide-source-control__path">{{ change.path }}</span>
                </span>
              </li>
            </ul>
          </template>
        </div>
        <button
          v-if="unstagedChanges.length"
          type="button"
          class="ide-source-control__stage-all"
          data-action="source-control-stage-all"
          :disabled="busy"
          @click="emit('stage', unstagedChanges.map((change) => change.path))"
        >
          {{ t('ide.sourceControl.stageAll') }}
        </button>
      </template>

      <p class="ide-source-control__history-title">{{ t('ide.sourceControl.history') }}</p>
      <p v-if="!history.length" class="empty-state ide-source-control__hint" data-testid="source-control-no-history">
        {{ t('ide.sourceControl.noHistory') }}
      </p>
      <ul v-else class="ide-source-control__history" data-testid="source-control-history" :aria-label="t('ide.sourceControl.history')">
        <li v-for="commit in history" :key="commit.full" class="ide-source-control__commit-entry" :data-commit="commit.short">
          <span class="ide-source-control__commit-short">{{ commit.short }}</span>
          <span class="ide-source-control__commit-subject">{{ commit.subject }}</span>
          <span class="ide-source-control__commit-meta">{{ commit.author }}</span>
        </li>
      </ul>
    </template>
  </section>
</template>
