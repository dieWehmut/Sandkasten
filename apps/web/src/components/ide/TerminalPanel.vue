<script setup lang="ts">
import { computed } from 'vue';
import { ChevronDown, Columns2, Plus, SquareTerminal, Trash2 } from '@lucide/vue';
import type { TerminalController } from '../../composables/useTerminal';
import TerminalPane from './TerminalPane.vue';
import { useTranslation } from '../../i18n/useTranslation';

const props = defineProps<{ controller: TerminalController }>();
const t = useTranslation();
const active = computed(() => props.controller.sessions.value.find((session) => session.id === props.controller.activeId.value));
const visible = computed(() => props.controller.visibleIds.value.flatMap((id) => {
  const session = props.controller.sessions.value.find((entry) => entry.id === id);
  return session ? [session] : [];
}));
function createProfile(event: Event): void {
  const select = event.target as HTMLSelectElement;
  if (select.value) void props.controller.create(select.value);
  select.value = '';
}
</script>

<template>
  <section class="terminal-panel" data-testid="terminal-panel" :aria-label="t('terminal.title')">
    <header class="terminal-toolbar">
      <span class="terminal-toolbar__title" :title="active?.cwd">{{ active?.title ?? t('terminal.title') }}</span>
      <div class="terminal-toolbar__actions">
        <button type="button" data-action="terminal-new" :disabled="Boolean(controller.pending.value)" :aria-label="t('terminal.new')" :title="`${t('terminal.new')} (Ctrl+Shift+\`)`" @click="controller.create()"><Plus :size="16" aria-hidden="true" /></button>
        <label class="terminal-profile-picker" :title="t('terminal.profile')">
          <ChevronDown :size="14" aria-hidden="true" />
          <select data-testid="terminal-profile" :aria-label="t('terminal.profile')" :disabled="Boolean(controller.pending.value) || !controller.profiles.value.length" @change="createProfile">
            <option value="">{{ t('terminal.profile') }}</option>
            <option v-for="profile in controller.profiles.value" :key="profile.id" :value="profile.id">{{ profile.label }}{{ profile.isDefault ? ` (${t('terminal.default')})` : '' }}</option>
          </select>
        </label>
        <button type="button" data-action="terminal-split" :disabled="Boolean(controller.pending.value)" :aria-label="t('terminal.split')" :title="t('terminal.split')" @click="controller.split()"><Columns2 :size="16" aria-hidden="true" /></button>
        <button type="button" data-action="terminal-close" :disabled="!active" :aria-label="t('terminal.close')" :title="t('terminal.close')" @click="controller.close()"><Trash2 :size="16" aria-hidden="true" /></button>
      </div>
    </header>
    <p v-if="controller.error.value" class="terminal-error" role="alert">{{ controller.error.value }}</p>
    <div v-if="controller.sessions.value.length" class="terminal-workspace">
      <div class="terminal-panes" :class="{ 'terminal-panes--split': visible.length === 2 }">
        <TerminalPane v-for="session in visible" :key="session.id" :controller="controller" :session="session" :active="session.id === controller.activeId.value" />
      </div>
      <nav class="terminal-sessions" :aria-label="t('terminal.sessions')">
        <button v-for="session in controller.sessions.value" :key="session.id" type="button" data-testid="terminal-session" :data-session-id="session.id" :aria-pressed="session.id === controller.activeId.value" :title="`${session.title} — ${session.cwd}`" @click="controller.select(session.id)">
          <SquareTerminal :size="14" aria-hidden="true" /><span>{{ session.title }}</span><span v-if="session.exitCode !== undefined" class="terminal-session__exited">{{ t('terminal.finished') }}</span>
        </button>
      </nav>
    </div>
    <div v-else class="terminal-empty">
      <span>{{ controller.pending.value ? t('terminal.starting') : t('terminal.empty') }}</span>
      <button v-if="!controller.pending.value" type="button" @click="controller.create()">{{ t('terminal.new') }}</button>
    </div>
  </section>
</template>
