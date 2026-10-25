<script setup lang="ts">
import type { Translator } from '../i18n/locale';

withDefaults(defineProps<{
  open: boolean;
  file: string;
  t: Translator;
  // Deleting a file is not recoverable the way closing a tab is, so it says so.
  intent?: 'close' | 'delete';
}>(), { intent: 'close' });
const emit = defineEmits<{ discard: []; cancel: [] }>();
</script>

<template>
  <div v-if="open" class="discard-layer" data-testid="discard-layer">
    <button
      type="button"
      class="discard-backdrop"
      tabindex="-1"
      :aria-label="t('discard.cancel')"
      @click="emit('cancel')"
    />
    <section
      class="discard-dialog"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="discard-title"
      aria-describedby="discard-body"
      tabindex="-1"
      data-testid="discard-dialog"
      @keydown.escape.prevent="emit('cancel')"
    >
      <h2 id="discard-title">{{ t(intent === 'delete' ? 'discard.deleteTitle' : 'discard.title') }}</h2>
      <p id="discard-body" class="discard-dialog__body">{{ t(intent === 'delete' ? 'discard.deleteBody' : 'discard.body') }}</p>
      <p class="discard-dialog__file" data-testid="discard-file">{{ file }}</p>
      <div class="discard-dialog__actions">
        <button type="button" data-action="discard-cancel" @click="emit('cancel')">
          {{ t(intent === 'delete' ? 'discard.deleteCancel' : 'discard.cancel') }}
        </button>
        <button type="button" data-action="discard-confirm" class="discard-dialog__confirm" @click="emit('discard')">
          {{ t(intent === 'delete' ? 'discard.deleteConfirm' : 'discard.confirm') }}
        </button>
      </div>
    </section>
  </div>
</template>
