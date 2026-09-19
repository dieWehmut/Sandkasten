<script setup lang="ts">
import { computed } from 'vue';
import brandMark from '../assets/brand-88.png?inline';
import { useTranslation } from '../i18n/useTranslation';

const props = defineProps<{
  desktop?: boolean;
  platform?: string;
}>();
const emit = defineEmits<{
  newFile: [];
  openFolder: [];
  openSetup: [];
}>();
const t = useTranslation();
const isMac = computed(() => props.platform
  ? props.platform === 'darwin'
  : typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform));
</script>

<template>
  <section class="editor-welcome" data-testid="editor-welcome" :aria-label="t('ide.welcome.label')">
    <img class="editor-welcome__mark" :src="brandMark" alt="" aria-hidden="true" draggable="false" />
    <div class="editor-welcome__actions">
      <button
        type="button"
        data-action="welcome-new-file"
        :aria-keyshortcuts="isMac ? 'Meta+N' : 'Control+N'"
        @click="emit('newFile')"
      >
        <span>{{ t('ide.explorer.newFile') }}</span>
        <span class="editor-welcome__shortcut" aria-hidden="true"><kbd>{{ isMac ? 'Cmd' : 'Ctrl' }}</kbd><kbd>N</kbd></span>
      </button>
      <button v-if="desktop" type="button" data-action="welcome-open-folder" @click="emit('openFolder')">
        <span>{{ t('ide.explorer.openFolder') }}</span>
      </button>
      <button type="button" data-action="welcome-open-setup" @click="emit('openSetup')">
        <span>{{ t('ide.activity.setup') }}</span>
      </button>
    </div>
  </section>
</template>

<style scoped>
.editor-welcome {
  display: flex;
  min-width: 0;
  min-height: 100%;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 28px;
  padding: 32px 20px;
  color: var(--text-muted);
}

.editor-welcome__mark {
  width: clamp(112px, 15vw, 176px);
  height: auto;
  flex: 0 0 auto;
  border-radius: 24%;
  filter: grayscale(1);
  opacity: .24;
  user-select: none;
}

.editor-welcome__actions {
  display: grid;
  width: min(100%, 260px);
  gap: 6px;
}

.editor-welcome__actions button {
  display: flex;
  min-height: 32px;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 5px 8px;
  border: 0;
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  background: transparent;
  font-size: 13px;
  text-align: left;
}

.editor-welcome__actions button:hover {
  color: var(--text);
  background: var(--surface-subtle);
}

.editor-welcome__shortcut {
  display: inline-flex;
  flex: 0 0 auto;
  gap: 4px;
}

.editor-welcome__shortcut kbd {
  min-width: 20px;
  padding: 0 5px;
  border: 1px solid var(--border);
  border-radius: 3px;
  color: var(--text-muted);
  font: 11px/19px var(--font-ui);
  text-align: center;
}
</style>
