<script setup lang="ts">
import { Terminal } from '@lucide/vue';
import type { ConnectionState } from '../composables/useRunner';
import type { Theme } from '../composables/useTheme';
import ConnectionStatus from './ConnectionStatus.vue';
import HeaderActions from './HeaderActions.vue';

defineProps<{ connectionState: ConnectionState; historyOpen?: boolean; inspectorOpen?: boolean; theme?: Theme }>();
const emit = defineEmits<{ toggleHistory: []; toggleInspector: []; toggleTheme: []; openGithub: [] }>();
</script>

<template>
  <header class="app-header" data-testid="app-header">
    <a class="brand" href="./" aria-label="Sandkasten home">
      <Terminal :size="19" aria-hidden="true" />
      <strong>Sandkasten</strong>
    </a>
    <ConnectionStatus :state="connectionState" />
    <HeaderActions
      :history-open="historyOpen"
      :inspector-open="inspectorOpen"
      :theme="theme"
      @toggle-history="emit('toggleHistory')"
      @toggle-inspector="emit('toggleInspector')"
      @toggle-theme="emit('toggleTheme')"
      @open-github="emit('openGithub')"
    />
  </header>
</template>
