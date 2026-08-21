<script setup lang="ts">
import { computed } from 'vue';
import { GitFork, History, Moon, PanelRight, Sun } from '@lucide/vue';
import type { Theme } from '../composables/useTheme';

const props = withDefaults(defineProps<{ historyOpen?: boolean; inspectorOpen?: boolean; theme?: Theme }>(), { theme: 'light' });
const emit = defineEmits<{ toggleHistory: []; toggleInspector: []; toggleTheme: []; openGithub: [] }>();
const themeLabel = computed(() => `Use ${props.theme === 'light' ? 'dark' : 'light'} theme`);
</script>

<template>
  <nav class="header-actions" aria-label="Workbench actions">
    <button
      type="button"
      :aria-label="historyOpen ? 'Hide history' : 'Show history'"
      :title="historyOpen ? 'Hide history' : 'Show history'"
      :aria-expanded="Boolean(historyOpen)"
      aria-controls="history-panel"
      @click="emit('toggleHistory')"
    >
      <History :size="17" aria-hidden="true" />
    </button>
    <button
      type="button"
      :aria-label="inspectorOpen ? 'Hide inspector' : 'Show inspector'"
      :title="inspectorOpen ? 'Hide inspector' : 'Show inspector'"
      :aria-expanded="Boolean(inspectorOpen)"
      aria-controls="inspector-panel"
      @click="emit('toggleInspector')"
    >
      <PanelRight :size="17" aria-hidden="true" />
    </button>
    <button type="button" :aria-label="themeLabel" :title="themeLabel" @click="emit('toggleTheme')">
      <Moon v-if="theme === 'light'" :size="17" aria-hidden="true" />
      <Sun v-else :size="17" aria-hidden="true" />
    </button>
    <button type="button" aria-label="Open GitHub repository" title="Open GitHub repository" @click="emit('openGithub')">
      <GitFork :size="17" aria-hidden="true" />
    </button>
  </nav>
</template>
