<script setup lang="ts">
import { computed } from 'vue';
import { Check, ChevronDown, GitBranch, Plus, RefreshCw } from '@lucide/vue';
import type { WorkspaceChange, WorkspaceCommit } from '../../services/desktopBridge';
import type { SourceControlState } from '../../composables/useSourceControl';
import { buildCommitGraph, formatCommitAge } from '../../editor/commitGraph';
import { useTranslation } from '../../i18n/useTranslation';

// The view renders the repository the controller loaded and raises the actions it
// offers. It never runs git itself and never invents a change list.
//
// The layout follows the reference's Source Control view: a repository row with
// its refresh action, the commit-message box above a full-width commit button,
// then the "Changes" and "Graph" groups. A changed file shows its directory tail
// in muted text followed by its own name, with the status letter on the right;
// the history is one 22 px rail row per commit.
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

// The reference splits the working tree into "Staged Changes" and "Changes" and
// hides a section that has no entries, so the view filters rather than printing
// an empty heading.
const sections = computed(() => [
  { key: 'staged', label: t('ide.sourceControl.stagedChanges'), entries: props.stagedChanges, staged: true },
  { key: 'changes', label: t('ide.sourceControl.changes'), entries: props.unstagedChanges, staged: false },
].filter((section) => section.entries.length > 0));

// The history is laid out once per change to the commit list. The rows carry
// their own rail geometry so the template only has to draw what it is handed.
const graph = computed(() => buildCommitGraph(props.history));

function ageText(commit: WorkspaceCommit): string {
  return formatCommitAge(commit.committedAt ? Date.now() - commit.committedAt : 0);
}

// The reference's status letter: the index letter wins for a staged file and the
// work-tree letter for an unstaged one. `?` would read as a blank, so a file git
// does not track yet is labelled `U`.
function statusLetter(change: WorkspaceChange): string {
  const index = change.index?.trim();
  const worktree = change.worktree?.trim();
  if (index === '?' || worktree === '?') return 'U';
  if (change.staged) return index || 'M';
  return worktree || index || 'M';
}

// The reference tints the letter by the change's kind, using the
// `gitDecoration.*ResourceForeground` tokens.
function statusTone(change: WorkspaceChange): string {
  const letter = statusLetter(change);
  if (letter === 'U' || letter === 'A') return 'added';
  if (letter === 'D') return 'deleted';
  if (letter === 'R' || letter === 'C') return 'renamed';
  return 'modified';
}

// A changed file is shown as its directory tail plus its own name, so a long path
// in a deep tree still says which file changed.
function pathParts(path: string): { name: string; directory: string } {
  const cut = path.lastIndexOf('/');
  if (cut === -1) return { name: path, directory: '' };
  return { name: path.slice(cut + 1), directory: path.slice(0, cut + 1) };
}

// Lane centres sit at `pitch * (column + 1)`, so column 0 starts one pitch in.
function laneCentre(column: number): number {
  return column * 11 + 11;
}
</script>

<template>
  <section class="scm ide-source-control" data-testid="source-control" :aria-label="t('ide.sourceControl.label')">
    <p v-if="!desktop" class="empty-state scm__hint" data-testid="source-control-desktop-only">
      {{ t('ide.sourceControl.desktopOnly') }}
    </p>
    <p v-else-if="error" class="ide-explorer__error" role="alert" data-testid="source-control-error">{{ error }}</p>
    <p v-else-if="state === 'loading'" class="empty-state scm__hint" data-testid="source-control-loading">
      {{ t('ide.sourceControl.loading') }}
    </p>
    <template v-else-if="state === 'empty'">
      <p class="empty-state scm__hint" data-testid="source-control-no-repository">
        {{ t('ide.sourceControl.noRepository') }}
      </p>
    </template>
    <template v-else>
      <div class="scm__repository" data-testid="source-control-branch">
        <GitBranch class="scm__repository-icon" :size="14" aria-hidden="true" />
        <span class="scm__repository-name" :title="branch">{{ branch }}</span>
        <button
          type="button"
          class="scm__icon-button"
          data-action="source-control-refresh"
          :aria-label="t('ide.sourceControl.refresh')"
          :title="t('ide.sourceControl.refresh')"
          :disabled="busy"
          @click="emit('refresh')"
        >
          <RefreshCw :size="14" aria-hidden="true" />
        </button>
      </div>

      <form class="scm__commit" data-testid="source-control-commit-form" @submit.prevent="emit('commit')">
        <textarea
          :value="message"
          data-testid="source-control-message"
          class="scm__message"
          rows="2"
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
          class="scm__commit-button"
          data-action="source-control-commit"
          :disabled="!canCommit"
        >
          <Check :size="14" aria-hidden="true" />
          {{ t('ide.sourceControl.commit') }}
          <span class="scm__commit-split" aria-hidden="true">
            <ChevronDown :size="12" />
          </span>
        </button>
      </form>

      <p v-if="!sections.length" class="empty-state scm__hint" data-testid="source-control-clean">
        {{ t('ide.sourceControl.clean') }}
      </p>
      <div v-for="section in sections" :key="section.key" class="scm__section" :data-group="section.key">
        <div class="scm__section-head">
          <ChevronDown class="scm__section-chevron" :size="14" aria-hidden="true" />
          <span class="scm__section-title">{{ section.label }}</span>
          <span class="scm__count">{{ section.entries.length }}</span>
          <button
            v-if="!section.staged"
            type="button"
            class="scm__icon-button scm__section-action"
            data-action="source-control-stage-all"
            :aria-label="t('ide.sourceControl.stageAll')"
            :title="t('ide.sourceControl.stageAll')"
            :disabled="busy"
            @click="emit('stage', section.entries.map((change) => change.path))"
          >
            <Plus :size="14" aria-hidden="true" />
          </button>
        </div>
        <ul class="scm__files" :aria-label="section.label">
          <li v-for="change in section.entries" :key="change.path" class="scm__file" :data-change="change.path">
            <!-- An unstaged row stages its file on click. A staged row has no
                 bridge call to unstage, so it is presented as a plain row rather
                 than a button that would do nothing. -->
            <button
              v-if="!section.staged"
              type="button"
              class="scm__file-row"
              :data-stage="change.path"
              :title="t('ide.sourceControl.stageFile')"
              :disabled="busy"
              @click="emit('stage', [change.path])"
            >
              <span class="scm__file-label" :title="change.path">
                <span class="scm__file-tail">{{ pathParts(change.path).directory }}</span><span class="scm__file-name">{{ pathParts(change.path).name }}</span>
              </span>
              <span class="scm__file-letter" :class="'scm__file-letter--' + statusTone(change)">{{ statusLetter(change) }}</span>
            </button>
            <div v-else class="scm__file-row scm__file-row--static">
              <span class="scm__file-label" :title="change.path">
                <span class="scm__file-tail">{{ pathParts(change.path).directory }}</span><span class="scm__file-name">{{ pathParts(change.path).name }}</span>
              </span>
              <span class="scm__file-letter" :class="'scm__file-letter--' + statusTone(change)">{{ statusLetter(change) }}</span>
            </div>
          </li>
        </ul>
      </div>

      <div class="scm__section">
        <div class="scm__section-head">
          <ChevronDown class="scm__section-chevron" :size="14" aria-hidden="true" />
          <span class="scm__section-title">{{ t('ide.sourceControl.history') }}</span>
          <span v-if="history.length" class="scm__count">{{ history.length }}</span>
        </div>
        <p v-if="!history.length" class="empty-state scm__hint" data-testid="source-control-no-history">
          {{ t('ide.sourceControl.noHistory') }}
        </p>
        <ul v-else class="scm__history" data-testid="source-control-history" :aria-label="t('ide.sourceControl.history')">
          <li
            v-for="row in graph.rows"
            :key="row.commit.full"
            class="scm__commit-entry"
            :data-commit="row.commit.short"
            :data-column="row.column"
            :data-head="row.head ? 'true' : 'false'"
          >
            <svg
              class="scm__graph"
              data-testid="source-control-graph"
              :width="row.width"
              height="22"
              :viewBox="'0 0 ' + row.width + ' 22'"
              aria-hidden="true"
            >
              <line
                v-for="(stroke, index) in row.strokes"
                :key="'s' + index"
                :x1="laneCentre(stroke.column)"
                :y1="stroke.from"
                :x2="laneCentre(stroke.column)"
                :y2="stroke.to"
                :stroke="stroke.color"
                :stroke-width="stroke.active ? 2 : 1.5"
                stroke-linecap="round"
              />
              <path
                v-for="(curve, index) in row.curves"
                :key="'c' + index"
                :d="curve.path"
                fill="none"
                :stroke="curve.color"
                stroke-width="1.5"
                stroke-linecap="round"
              />
              <circle
                v-if="row.dot.kind !== 'normal'"
                :cx="laneCentre(row.dot.column)"
                cy="11"
                :r="row.dot.radius"
                :stroke="row.dot.color"
                :stroke-width="row.dot.strokeWidth"
                fill="none"
                class="scm__graph-ring"
              />
              <circle
                :cx="laneCentre(row.dot.column)"
                cy="11"
                r="4"
                :fill="row.head ? 'var(--chrome)' : row.dot.color"
                :stroke="row.dot.color"
                stroke-width="2"
                class="scm__graph-dot"
                :class="{ 'scm__graph-dot--head': row.head }"
              />
            </svg>
            <span class="scm__commit-subject" :title="row.commit.subject">{{ row.commit.subject }}</span>
            <span
              v-for="ref in row.commit.refs ?? []"
              :key="ref"
              class="scm__commit-ref"
              :data-ref="ref"
            >{{ ref }}</span>
            <span class="scm__commit-age">{{ ageText(row.commit) }}</span>
          </li>
        </ul>
      </div>
    </template>
  </section>
</template>
