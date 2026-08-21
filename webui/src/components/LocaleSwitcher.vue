<script setup lang="ts">
import type { Locale, Translator } from '../i18n/locale';

defineProps<{ locale: Locale; t: Translator }>();
const emit = defineEmits<{ change: [locale: Locale] }>();
</script>

<template>
  <div
    class="locale-switcher"
    data-testid="locale-switcher"
    role="group"
    :aria-label="t('locale.label')"
  >
    <button
      type="button"
      data-locale="en"
      data-action="set-locale-en"
      :aria-label="t('locale.switchToEnglish')"
      :title="t('locale.switchToEnglish')"
      :aria-pressed="locale === 'en'"
      @click="emit('change', 'en')"
    >
      EN
    </button>
    <button
      type="button"
      data-locale="zh-CN"
      data-action="set-locale-zh-CN"
      :aria-label="t('locale.switchToChinese')"
      :title="t('locale.switchToChinese')"
      :aria-pressed="locale === 'zh-CN'"
      @click="emit('change', 'zh-CN')"
    >
      中文
    </button>
  </div>
</template>
