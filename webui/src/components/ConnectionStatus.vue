<script setup lang="ts">
import { computed } from 'vue';
import { CircleAlert, CircleCheck, LoaderCircle } from '@lucide/vue';
import type { ConnectionState } from '../composables/useRunner';

const props = defineProps<{ state: ConnectionState }>();
const label = computed(() => ({ connecting: 'Connecting', connected: 'Connected', unavailable: 'Unavailable' }[props.state]));
</script>

<template>
  <span class="connection-status" :data-state="state" aria-live="polite">
    <LoaderCircle v-if="state === 'connecting'" :size="15" aria-hidden="true" />
    <CircleCheck v-else-if="state === 'connected'" :size="15" aria-hidden="true" />
    <CircleAlert v-else :size="15" aria-hidden="true" />
    <span>{{ label }}</span>
  </span>
</template>

