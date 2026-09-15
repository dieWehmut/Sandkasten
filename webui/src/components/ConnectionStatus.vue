<script setup lang="ts">
import { computed } from 'vue';
import { CircleAlert, CircleCheck, LoaderCircle } from '@lucide/vue';
import type { ConnectionState } from '../composables/useRunner';
import type { MessageKey } from '../i18n/messages';
import type { Translator } from '../i18n/locale';
import { useTranslation } from '../i18n/useTranslation';

const props = defineProps<{ state: ConnectionState; t?: Translator }>();
const injectedTranslator = useTranslation();
const stateKeys: Readonly<Record<ConnectionState, MessageKey>> = {
  connecting: 'connection.connecting',
  connected: 'connection.connected',
  unavailable: 'connection.unavailable',
};
const label = computed(() => (props.t ?? injectedTranslator)(stateKeys[props.state]));
</script>

<template>
  <span class="connection-status" :data-state="state" aria-live="polite">
    <LoaderCircle v-if="state === 'connecting'" :size="15" aria-hidden="true" />
    <CircleCheck v-else-if="state === 'connected'" :size="15" aria-hidden="true" />
    <CircleAlert v-else :size="15" aria-hidden="true" />
    <span>{{ label }}</span>
  </span>
</template>
