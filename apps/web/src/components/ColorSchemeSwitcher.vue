<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { Palette } from '@lucide/vue';
import { colorSchemeOptions, type ColorScheme } from '../theme/colorScheme';
import { createTranslator, type Locale, type Translator } from '../i18n/locale';

const props = withDefaults(defineProps<{
  colorScheme: ColorScheme;
  locale?: Locale;
  t?: Translator;
}>(), { locale: 'en' });

const emit = defineEmits<{ change: [scheme: ColorScheme] }>();

const root = ref<HTMLElement>();
const isOpen = ref(false);
const englishTranslator = createTranslator('en');
const translate = computed(() => props.t ?? englishTranslator);
const label = computed(() => translate.value('header.colorScheme'));
const options = computed(() => colorSchemeOptions.map((option) => ({
  ...option,
  label: translate.value(`colorScheme.${option.id}`),
})));

function selectScheme(scheme: ColorScheme): void {
  isOpen.value = false;
  emit('change', scheme);
}

function handleDocumentPointerDown(event: PointerEvent): void {
  if (!isOpen.value) return;
  if (event.target instanceof Node && root.value?.contains(event.target)) return;
  isOpen.value = false;
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || !isOpen.value) return;
  isOpen.value = false;
  root.value?.querySelector('button')?.focus();
}

onMounted(() => {
  document.addEventListener('pointerdown', handleDocumentPointerDown);
  document.addEventListener('keydown', handleKeydown);
});

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', handleDocumentPointerDown);
  document.removeEventListener('keydown', handleKeydown);
});
</script>

<template>
  <div ref="root" class="color-scheme-switcher" :data-open="isOpen ? 'true' : 'false'">
    <button
      type="button"
      data-testid="color-scheme-switcher"
      data-action="toggle-color-scheme"
      :aria-label="label"
      :title="label"
      :aria-expanded="isOpen"
      aria-haspopup="true"
      @click="isOpen = !isOpen"
    >
      <Palette :size="17" aria-hidden="true" />
    </button>
    <div
      v-if="isOpen"
      class="color-scheme-switcher__menu"
      role="group"
      :aria-label="label"
      data-testid="color-scheme-menu"
    >
      <button
        v-for="option in options"
        :key="option.id"
        type="button"
        :data-scheme="option.id"
        :data-action="`set-color-scheme-${option.id}`"
        :aria-label="option.label"
        :title="option.label"
        :aria-pressed="colorScheme === option.id"
        @click="selectScheme(option.id)"
      >
        <span
          class="color-scheme-switcher__swatch"
          :style="{ '--scheme-swatch': option.preview }"
          aria-hidden="true"
        />
        <span class="color-scheme-switcher__label">{{ option.label }}</span>
      </button>
    </div>
  </div>
</template>