<script setup lang="ts">
import { CaseSensitive, Search, X } from '@lucide/vue';
import type { WorkspaceSearchFile } from '../../services/workspaceSearch';
import type { WorkspaceSearchState } from '../../composables/useWorkspaceSearch';
import type { IconTheme } from '../../editor/fileIcon';
import { useTranslation } from '../../i18n/useTranslation';
import FileIcon from '../FileIcon.vue';

// The view renders whatever the controller found. It never issues a search of
// its own, so the shell keeps one authoritative result set.
const props = withDefaults(defineProps<{
  state: WorkspaceSearchState;
  query: string;
  files?: WorkspaceSearchFile[];
  caseSensitive?: boolean;
  fileCount?: number;
  matchCount?: number;
  truncated?: boolean;
  error?: string;
  desktop?: boolean;
  busy?: boolean;
  iconTheme?: IconTheme;
}>(), {
  files: () => [], caseSensitive: false, fileCount: 0, matchCount: 0,
  truncated: false, desktop: true, busy: false, iconTheme: 'dark',
});

const emit = defineEmits<{
  'update:query': [value: string];
  'update:caseSensitive': [value: boolean];
  search: [query: string];
  select: [path: string];
  clear: [];
}>();

const t = useTranslation();

function submit(): void {
  const value = props.query.trim();
  if (!value) return;
  emit('search', value);
}

function toggleCase(value: boolean): void {
  emit('update:caseSensitive', value);
}

// The translator returns whole strings, so counts are composed here: the
// summary reads "N results in M files" without a template language.
function countLabel(count: number, singular: 'result' | 'file'): string {
  const key = count === 1 ? `ide.search.${singular}` : `ide.search.${singular}s`;
  return `${count} ${t(key as 'ide.search.results')}`;
}
function resultsSummary(): string {
  return `${countLabel(props.matchCount, 'result')} ${t('ide.search.inFiles')} ${countLabel(props.fileCount, 'file')}`;
}
function emptyLabel(): string {
  return `${t('ide.search.noResults')} ${props.query}`;
}
</script>

<template>
  <section class="ide-search" data-testid="workspace-search" :aria-label="t('ide.search.label')">
    <form class="ide-search__form" data-testid="workspace-search-form" @submit.prevent="submit">
      <div class="ide-search__field">
        <Search :size="14" aria-hidden="true" />
        <input
          :value="query"
          data-testid="workspace-search-input"
          type="search"
          name="searchQuery"
          autocomplete="off"
          spellcheck="false"
          :placeholder="t('ide.search.placeholder')"
          :aria-label="t('ide.search.label')"
          :disabled="!desktop"
          @input="emit('update:query', ($event.target as HTMLInputElement).value)"
        >
        <button
          v-if="query"
          type="button"
          data-testid="workspace-search-clear"
          :aria-label="t('ide.search.clear')"
          :title="t('ide.search.clear')"
          @click="emit('clear')"
        >
          <X :size="13" aria-hidden="true" />
        </button>
      </div>
      <div class="ide-search__toggles">
        <label class="ide-search__toggle" :title="t('ide.search.matchCase')">
          <input
            data-testid="workspace-search-case"
            type="checkbox"
            :checked="caseSensitive"
            :disabled="!desktop"
            @change="toggleCase(($event.target as HTMLInputElement).checked)"
          >
          <CaseSensitive :size="14" aria-hidden="true" />
          <span class="ide-search__toggle-text">{{ t('ide.search.matchCase') }}</span>
        </label>
      </div>
    </form>

    <p v-if="!desktop" class="empty-state ide-search__hint" data-testid="workspace-search-unavailable">
      {{ t('ide.search.desktopOnly') }}
    </p>
    <p v-else-if="error" class="ide-explorer__error" role="alert">{{ error }}</p>
    <p v-else-if="state === 'searching'" class="empty-state ide-search__hint" data-testid="workspace-search-busy">
      {{ t('ide.search.searching') }}
    </p>
    <p v-else-if="state === 'empty'" class="empty-state ide-search__hint" data-testid="workspace-search-empty">
      {{ emptyLabel() }}
    </p>

    <template v-else-if="files.length">
      <p class="ide-search__summary" data-testid="workspace-search-summary">{{ resultsSummary() }}</p>
      <p v-if="truncated" class="ide-search__truncated" data-testid="workspace-search-truncated" role="status">
        {{ t('ide.search.truncated') }}
      </p>
      <ul class="ide-search__results" :aria-label="t('ide.search.resultsLabel')">
        <li v-for="file in files" :key="file.path" class="ide-search__file" :data-match-path="file.path">
          <span class="ide-search__file-head">
            <FileIcon :path="file.path" :name="file.name" :theme="iconTheme" :size="14" />
            <span class="ide-search__file-name">{{ file.name }}</span>
            <span class="ide-search__file-path">{{ file.path }}</span>
          </span>
          <ul class="ide-search__lines">
            <li v-for="match in file.matches" :key="`${file.path}:${match.line}`">
              <button type="button" class="ide-search__line" :data-line="match.line" @click="emit('select', file.path)">
                <span class="ide-search__line-number">{{ match.line }}</span>
                <span class="ide-search__line-text">{{ match.text }}</span>
              </button>
            </li>
          </ul>
        </li>
      </ul>
    </template>
  </section>
</template>
