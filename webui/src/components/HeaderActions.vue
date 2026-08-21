<script setup lang="ts">
import { GitFork, History, PanelRight, SunMoon } from '@lucide/vue';

defineProps<{ historyOpen?: boolean; inspectorOpen?: boolean }>();
const emit = defineEmits<{ toggleHistory: []; toggleInspector: []; toggleTheme: []; openGithub: [] }>();
</script>

<template>
  <nav class="header-actions" aria-label="Workbench actions">
    <button type="button" :aria-label="historyOpen ? 'Hide history' : 'Show history'" :title="historyOpen ? 'Hide history' : 'Show history'" @click="emit('toggleHistory')">
      <History :size="17" aria-hidden="true" />
    </button>
    <button type="button" :aria-label="inspectorOpen ? 'Hide inspector' : 'Show inspector'" :title="inspectorOpen ? 'Hide inspector' : 'Show inspector'" @click="emit('toggleInspector')">
      <PanelRight :size="17" aria-hidden="true" />
    </button>
    <button type="button" aria-label="Toggle theme" title="Toggle theme" @click="emit('toggleTheme')">
      <SunMoon :size="17" aria-hidden="true" />
    </button>
    <button type="button" aria-label="Open GitHub repository" title="Open GitHub repository" @click="emit('openGithub')">
      <GitFork :size="17" aria-hidden="true" />
    </button>
  </nav>
</template>
