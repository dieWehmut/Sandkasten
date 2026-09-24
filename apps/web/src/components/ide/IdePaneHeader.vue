<script setup lang="ts">
import { ChevronDown } from '@lucide/vue';

// The sidebar's collapsible section header, following the measured VS Code pane
// header: a 22 px row whose whole width toggles the section, an 11 px semibold
// title, a chevron that points down while the section is expanded, and the view
// actions on the trailing edge, revealed while the row is hovered or focused.
withDefaults(defineProps<{ label: string; expanded?: boolean }>(), { expanded: true });
const emit = defineEmits<{ toggle: [] }>();
</script>

<template>
  <h3 class="ide-pane-header">
    <button
      type="button"
      class="ide-pane-header__toggle"
      :aria-expanded="expanded"
      :title="label"
      @click="emit('toggle')"
    >
      <span
        class="ide-pane-header__twisty"
        :class="{ 'ide-pane-header__twisty--collapsed': !expanded }"
        aria-hidden="true"
      >
        <ChevronDown :size="12" aria-hidden="true" />
      </span>
      <span class="ide-pane-header__title">{{ label }}</span>
    </button>
    <span v-if="$slots.actions" class="ide-pane-header__actions">
      <slot name="actions" />
    </span>
  </h3>
</template>