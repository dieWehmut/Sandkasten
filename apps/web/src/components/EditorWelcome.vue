<script setup lang="ts">
import { computed } from 'vue';
import { BookOpen, FilePlus, FolderOpen, Search, Settings } from '@lucide/vue';
import brandMark from '../assets/brand-88.png?inline';
import FileIcon from './FileIcon.vue';
import { useTranslation } from '../i18n/useTranslation';

// The empty-editor welcome, shaped like VS Code's Get Started tab: a header with
// the product name and its one-line description, a Start column with one tile
// per action, a Recent column of previously opened files, a second column of
// next steps, and a centred footer.
const props = withDefaults(defineProps<{
  desktop?: boolean;
  platform?: string;
  recent?: readonly string[];
}>(), { recent: () => [] });
const emit = defineEmits<{
  newFile: [];
  openFolder: [];
  openSetup: [];
  openSettings: [];
  openPalette: [];
  selectFile: [path: string];
}>();
const t = useTranslation();
const isMac = computed(() => props.platform
  ? props.platform === 'darwin'
  : typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform));
const modifier = computed(() => (isMac.value ? 'Cmd' : 'Ctrl'));
const hint = computed(() => t('ide.welcome.hint').replaceAll('{modifier}', modifier.value));
</script>

<template>
  <section class="editor-welcome" data-testid="editor-welcome" :aria-label="t('ide.welcome.label')">
    <div class="editor-welcome__grid">
      <header class="editor-welcome__header">
        <img class="editor-welcome__mark" :src="brandMark" alt="" aria-hidden="true" draggable="false" />
        <div>
          <h1 class="editor-welcome__title">{{ t('brand.name') }}</h1>
          <p class="editor-welcome__subtitle">{{ t('ide.welcome.subtitle') }}</p>
        </div>
      </header>

      <div class="editor-welcome__column editor-welcome__column--start">
        <section class="editor-welcome__section">
          <h2 class="editor-welcome__section-title">{{ t('ide.welcome.start') }}</h2>
          <div class="editor-welcome__tiles">
            <button
              type="button"
              class="editor-welcome__tile"
              data-action="welcome-new-file"
              :aria-keyshortcuts="isMac ? 'Meta+N' : 'Control+N'"
              @click="emit('newFile')"
            >
              <FilePlus :size="20" aria-hidden="true" />
              <span class="editor-welcome__label">{{ t('ide.explorer.newFile') }}</span>
              <span class="editor-welcome__shortcut" aria-hidden="true"><kbd>{{ modifier }}</kbd><kbd>N</kbd></span>
            </button>
            <button
              v-if="desktop"
              type="button"
              class="editor-welcome__tile"
              data-action="welcome-open-folder"
              @click="emit('openFolder')"
            >
              <FolderOpen :size="20" aria-hidden="true" />
              <span class="editor-welcome__label">{{ t('ide.explorer.openFolder') }}</span>
            </button>
            <button
              type="button"
              class="editor-welcome__tile"
              data-action="welcome-open-palette"
              @click="emit('openPalette')"
            >
              <Search :size="20" aria-hidden="true" />
              <span class="editor-welcome__label">{{ t('palette.title') }}</span>
            </button>
          </div>
        </section>

        <section class="editor-welcome__section">
          <h2 class="editor-welcome__section-title">{{ t('ide.welcome.recent') }}</h2>
          <ul v-if="recent.length" class="editor-welcome__recent" :aria-label="t('ide.welcome.recent')">
            <li v-for="path in recent" :key="path">
              <button
                type="button"
                class="editor-welcome__recent-item"
                :data-action="`welcome-recent-${path}`"
                :title="path"
                @click="emit('selectFile', path)"
              >
                <FileIcon :path="path" :size="16" />
                <span class="editor-welcome__path">{{ path }}</span>
              </button>
            </li>
          </ul>
          <p v-else class="editor-welcome__empty">{{ t('ide.welcome.noRecent') }}</p>
        </section>
      </div>

      <div class="editor-welcome__column editor-welcome__column--more">
        <section class="editor-welcome__section">
          <h2 class="editor-welcome__section-title">{{ t('ide.welcome.nextSteps') }}</h2>
          <div class="editor-welcome__tiles">
            <button
              type="button"
              class="editor-welcome__tile"
              data-action="welcome-open-setup"
              @click="emit('openSetup')"
            >
              <BookOpen :size="20" aria-hidden="true" />
              <span class="editor-welcome__label">{{ t('ide.activity.setup') }}</span>
            </button>
            <button
              type="button"
              class="editor-welcome__tile"
              data-action="welcome-open-settings"
              @click="emit('openSettings')"
            >
              <Settings :size="20" aria-hidden="true" />
              <span class="editor-welcome__label">{{ t('settings.title') }}</span>
            </button>
          </div>
        </section>
      </div>

      <footer class="editor-welcome__footer">
        <p>{{ hint }}</p>
      </footer>
    </div>
  </section>
</template>