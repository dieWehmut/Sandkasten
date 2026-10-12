<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { TerminalController, TerminalEntry, TerminalSuggestion } from '../../composables/useTerminal';
import { useTranslation } from '../../i18n/useTranslation';

const props = defineProps<{ controller: TerminalController; session: TerminalEntry; active: boolean }>();
const t = useTranslation();
const container = ref<HTMLElement>();
let observer: ResizeObserver | undefined;

// A command the shell reports about itself has no file behind it, and the strip
// says which kind it is offering rather than leaving the difference to the name.
const shellSource = computed(() => {
  const family = props.controller.profiles.value
    .find((profile) => profile.id === props.controller.activeProfileId.value)?.family;
  return family === 'powershell' ? t('terminal.source.cmdlet') : t('terminal.source.builtin');
});
function suggestionTitle(suggestion: TerminalSuggestion): string {
  const base = `${t('terminal.complete')} ${suggestion.label}`;
  return suggestion.source === 'shell' ? `${base} · ${shellSource.value}` : base;
}

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
    <!-- The shell the user is typing in can run these; the prefix model only
         suggests, it never inserts anything on its own. -->
    <div
      v-if="active && controller.suggestions.value.length" class="terminal-suggestions"
      data-testid="terminal-suggestions" role="listbox" :aria-label="t('terminal.suggestions')"
      :title="t('terminal.suggestionsHint')"
    >
      <button
        v-for="suggestion in controller.suggestions.value" :key="suggestion.value" type="button" role="option"
        data-testid="terminal-suggestion" :data-command="suggestion.label" :data-source="suggestion.source"
        class="terminal-suggestions__item" :class="{ 'terminal-suggestions__item--shell': suggestion.source === 'shell' }"
        :title="suggestionTitle(suggestion)"
        @pointerdown.prevent @click="controller.complete(suggestion)"
      >{{ suggestion.label }}</button>
    </div>
    <div v-if="session.exitCode !== undefined" class="terminal-pane__exit" role="status">
      {{ t('terminal.exited') }} {{ session.exitCode }}
    </div>
  </section>
</template>
