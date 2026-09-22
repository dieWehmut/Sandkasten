<script setup lang="ts">
import { computed } from 'vue';
import { GitBranch, GitCommitHorizontal, RefreshCw } from '@lucide/vue';
import type { WorkspaceChange, WorkspaceCommit } from '../../services/desktopBridge';
import type { SourceControlState } from '../../composables/useSourceControl';
import { buildCommitGraph, formatCommitAge } from '../../editor/commitGraph';
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

// The history is laid out once per change to the commit list. The rows carry
// their own lane geometry so the template only has to draw what it is handed.
const graph = computed(() => buildCommitGraph(props.history));

function ageText(commit: WorkspaceCommit): string {
  return formatCommitAge(commit.committedAt ? Date.now() - commit.committedAt : 0);
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
        <li
          v-for="row in graph.rows"
          :key="row.commit.full"
          class="ide-source-control__commit-entry"
          :data-commit="row.commit.short"
          :data-column="row.column"
          :data-head="row.commit.isHead ? 'true' : 'false'"
        >
          <!-- The graph rail: one column per lane, with the commit's own dot
               drawn as a ring when HEAD points at it, the way the reference
               marks the checked-out commit. -->
          <svg
            class="ide-source-control__graph"
            data-testid="source-control-graph"
            :width="(graph.columns + 1) * 10"
            height="22"
            :viewBox="'0 0 ' + (graph.columns + 1) * 10 + ' 22'"
            aria-hidden="true"
          >
            <g v-for="lane in row.lanes" :key="lane.column">
              <line
                v-if="lane.passThrough"
                :x1="lane.column * 10 + 5"
                :y1="lane.column === row.column ? 11 : 0"
                :x2="lane.column * 10 + 5"
                y2="22"
                class="ide-source-control__graph-line"
              />
              <line
                v-if="lane.column === row.column"
                :x1="lane.column * 10 + 5"
                y1="0"
                :x2="lane.column * 10 + 5"
                y2="11"
                class="ide-source-control__graph-line"
              />
            </g>
            <circle
              :cx="row.column * 10 + 5"
              cy="11"
              :r="row.commit.isHead ? 4 : 3.5"
              class="ide-source-control__graph-dot"
              :class="{ 'ide-source-control__graph-dot--head': row.commit.isHead }"
            />
          </svg>
          <span class="ide-source-control__commit-subject" :title="row.commit.subject">{{ row.commit.subject }}</span>
          <!-- The reference names the commit's author beside the rail, so the
               row carries it too; it truncates before the subject does. -->
          <span class="ide-source-control__commit-author" :title="row.commit.author">{{ row.commit.author }}</span>
          <span
            v-for="ref in row.commit.refs ?? []"
            :key="ref"
            class="ide-source-control__commit-ref"
            :data-ref="ref"
          >{{ ref }}</span>
          <span class="ide-source-control__commit-meta">{{ ageText(row.commit) }}</span>
        </li>
      </ul>
    </template>
  </section>
</template>
