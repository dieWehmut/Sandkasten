<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import type { Translator } from "../i18n/locale";
import { createTranslator } from "../i18n/locale";
import { LOCAL_API_BASE_URL, normalizeApiBaseUrl } from "../services/apiEndpoint";

// A small modal for the runtime API endpoint. The value is stored per browser
// profile by the caller; this component only owns the draft, validation, and
// the open/close cycle.
const props = withDefaults(defineProps<{
  open: boolean;
  value?: string;
  desktop?: boolean;
  t?: Translator;
}>(), { value: "", desktop: false });

const emit = defineEmits<{
  save: [value: string];
  close: [];
}>();

const englishTranslator = createTranslator("en");
const translate = computed(() => props.t ?? englishTranslator);
const draft = ref(props.value);
const validationError = ref("");
const input = ref<HTMLInputElement | null>(null);

const defaultHint = computed(() => (props.desktop
  ? translate.value("apiEndpoint.hint.local").replace("{url}", LOCAL_API_BASE_URL)
  : translate.value("apiEndpoint.hint.sameOrigin")));

function resetDraft(): void {
  draft.value = props.value;
  validationError.value = "";
}

watch(() => props.open, (open) => {
  if (!open) return;
  resetDraft();
  void nextTick(() => input.value?.focus());
}, { immediate: true });

function submit(): void {
  try {
    const normalized = normalizeApiBaseUrl(draft.value);
    validationError.value = "";
    emit("save", normalized);
  } catch (error) {
    // The validator reports machine-readable reasons; the interface shows one
    // localized sentence so the dialog does not leak transport wording.
    void error;
    validationError.value = translate.value("apiEndpoint.invalid");
  }
}
</script>

<template>
  <div v-if="open" class="api-endpoint-layer" data-testid="api-endpoint-layer">
    <button
      type="button"
      class="api-endpoint-backdrop"
      tabindex="-1"
      :aria-label="translate('apiEndpoint.cancel')"
      @click="emit('close')"
    />
    <section
      class="api-endpoint"
      role="dialog"
      aria-modal="true"
      aria-labelledby="api-endpoint-title"
      tabindex="-1"
      data-testid="api-endpoint-dialog"
      @keydown.escape.prevent="emit('close')"
    >
      <h2 id="api-endpoint-title">{{ translate('apiEndpoint.title') }}</h2>
      <p class="api-endpoint__hint" data-testid="api-endpoint-hint">{{ defaultHint }}</p>
      <form data-testid="api-endpoint-form" @submit.prevent="submit">
        <label class="api-endpoint__field">
          <span>{{ translate('apiEndpoint.label') }}</span>
          <input
            ref="input"
            v-model="draft"
            type="text"
            name="apiBaseUrl"
            inputmode="url"
            autocomplete="off"
            spellcheck="false"
            :placeholder="translate('apiEndpoint.placeholder')"
            data-testid="api-endpoint-input"
          >
        </label>
        <p v-if="validationError" class="api-endpoint__error" role="alert" data-testid="api-endpoint-error">
          {{ validationError }}
        </p>
        <div class="api-endpoint__actions">
          <button type="button" data-action="api-endpoint-cancel" @click="emit('close')">
            {{ translate('apiEndpoint.cancel') }}
          </button>
          <button type="submit" data-action="api-endpoint-save" class="api-endpoint__save">
            {{ translate('apiEndpoint.save') }}
          </button>
        </div>
      </form>
    </section>
  </div>
</template>
