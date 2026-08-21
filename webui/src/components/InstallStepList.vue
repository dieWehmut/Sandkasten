<script setup lang="ts">
import { computed } from 'vue';
import type { InstallMode, InstallStep } from '../setup/installGuide';

const props = defineProps<{ steps: readonly InstallStep[]; mode: InstallMode }>();
const visibleSteps = computed(() => props.steps.filter((step) => step.modes.includes(props.mode)));
</script>

<template>
  <ol class="install-step-list">
    <li v-for="(step, index) in visibleSteps" :key="step.id" data-testid="install-step">
      <span class="install-step-number" aria-hidden="true">{{ index + 1 }}</span>
      <div>
        <h3>{{ step.title }}</h3>
        <p>{{ step.description }}</p>
      </div>
    </li>
  </ol>
</template>
