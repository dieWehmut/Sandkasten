<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { TerminalController, TerminalEntry } from '../../composables/useTerminal';
import { useTranslation } from '../../i18n/useTranslation';

const props = defineProps<{ controller: TerminalController; session: TerminalEntry; active: boolean }>();
const t = useTranslation();
const container = ref<HTMLElement>();
let observer: ResizeObserver | undefined;

function labelInput(): void {
  container.value?.querySelector('textarea')?.setAttribute('aria-label', `${t('terminal.input')}: ${props.session.title}`);
}
onMounted(() => {
  if (!container.value) return;
  props.controller.mount(props.session.id, container.value);
  labelInput();
  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(() => props.controller.fit(props.session.id));
    observer.observe(container.value);
  }
});
watch(() => t('terminal.input'), labelInput);
onBeforeUnmount(() => { observer?.disconnect(); props.controller.unmount(props.session.id); });
</script>

<template>
  <section
    class="terminal-pane" :class="{ 'terminal-pane--active': active }"
    data-testid="terminal-pane" :data-session-id="session.id" :data-active="active"
    :aria-label="session.title" @focusin="controller.select(session.id)" @pointerdown="controller.select(session.id)"
  >
    <div ref="container" class="terminal-pane__viewport" />
    <div v-if="session.exitCode !== undefined" class="terminal-pane__exit" role="status">
      {{ t('terminal.exited') }} {{ session.exitCode }}
    </div>
  </section>
</template>
