<script setup lang="ts">
import { X } from '@lucide/vue';
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';

const props = withDefaults(defineProps<{ open: boolean; side?: 'left' | 'right'; title: string }>(), { side: 'right' });
const emit = defineEmits<{ close: [] }>();
const panel = ref<HTMLElement>();
const titleId = `edge-sheet-title-${Math.random().toString(36).slice(2)}`;
let returnFocus: HTMLElement | null = null;
let previousBodyOverflow = '';

function focusableElements(): HTMLElement[] {
  if (!panel.value) return [];
  return Array.from(panel.value.querySelectorAll<HTMLElement>(
    'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )).filter((element) => !element.hasAttribute('hidden'));
}

function lockBody(): void {
  if (typeof document === 'undefined') return;
  previousBodyOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
}

function unlockBody(): void {
  if (typeof document === 'undefined') return;
  document.body.style.overflow = previousBodyOverflow;
}

function close(): void {
  emit('close');
}

function activate(): void {
  returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  lockBody();
  const firstFocusable = focusableElements()[0];
  if (firstFocusable) firstFocusable.focus();
  else panel.value?.focus();
}

function deactivate(): void {
  unlockBody();
  returnFocus?.focus();
  returnFocus = null;
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault();
    close();
    return;
  }
  if (event.key !== 'Tab') return;

  const focusable = focusableElements();
  if (!focusable.length) {
    event.preventDefault();
    panel.value?.focus();
    return;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

onMounted(() => {
  if (props.open) activate();
});

watch(() => props.open, (open, wasOpen) => {
  if (open) activate();
  else if (wasOpen) deactivate();
}, { flush: 'post' });

onBeforeUnmount(() => {
  if (props.open) unlockBody();
  returnFocus?.focus();
});
</script>

<template>
  <Transition name="edge-sheet">
    <div v-if="open" class="edge-sheet-layer" :class="`edge-sheet-layer--${side}`">
      <button class="edge-sheet__backdrop" type="button" tabindex="-1" :aria-label="`Dismiss ${title}`" @click="close" />
      <section
        ref="panel"
        class="edge-sheet"
        :class="`edge-sheet--${side}`"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="titleId"
        tabindex="-1"
        data-testid="edge-sheet-panel"
        @keydown="handleKeydown"
      >
        <header class="edge-sheet__header">
          <h2 :id="titleId">{{ title }}</h2>
          <button type="button" :aria-label="`Close ${title}`" :title="`Close ${title}`" @click="close">
            <X :size="18" aria-hidden="true" />
          </button>
        </header>
        <div class="edge-sheet__body">
          <slot />
        </div>
      </section>
    </div>
  </Transition>
</template>

<style scoped>
.edge-sheet-layer { position: fixed; inset: 0; z-index: 50; }
.edge-sheet__backdrop { position: absolute; inset: 0; width: 100%; border: 0; background: rgb(22 19 21 / 54%); }
.edge-sheet { position: absolute; inset-block: 0; display: grid; grid-template-rows: auto minmax(0, 1fr); width: min(22rem, 88vw); overflow: hidden; background: #fff; }
.edge-sheet--left { left: 0; border-right: 1px solid #d9d3d4; }
.edge-sheet--right { right: 0; border-left: 1px solid #d9d3d4; }
.edge-sheet__header { display: flex; align-items: center; justify-content: space-between; min-height: 52px; padding: .65rem 1rem; border-bottom: 1px solid #d9d3d4; }
.edge-sheet__header h2 { margin: 0; font-size: 1rem; }
.edge-sheet__header button { display: inline-grid; width: 2rem; height: 2rem; place-items: center; }
.edge-sheet__body { min-width: 0; min-height: 0; overflow: auto; }
</style>
