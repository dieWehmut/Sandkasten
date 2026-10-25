<script setup lang="ts">
import { computed, ref } from 'vue';
import { RefreshCw } from '@lucide/vue';
import { isolatedPreviewHtml, type WebPreviewDocument } from '../editor/preview';
import { useTranslation } from '../i18n/useTranslation';

const props = defineProps<{ document: WebPreviewDocument }>();
const t = useTranslation();
const width = ref('responsive');
const revision = ref(0);
const html = computed(() => isolatedPreviewHtml(props.document.html));
</script>

<template>
  <section class="web-preview" data-testid="web-preview">
    <div class="web-preview__toolbar">
      <span>{{ t(document.mode === 'live' ? 'preview.live' : 'preview.compiled') }}</span>
      <select v-model="width" :aria-label="t('preview.width')">
        <option value="responsive">{{ t('preview.responsive') }}</option>
        <option value="375">375 px</option>
        <option value="768">768 px</option>
      </select>
      <button type="button" :aria-label="t('preview.refresh')" :title="t('preview.refresh')" @click="revision++"><RefreshCw :size="16" aria-hidden="true" /></button>
    </div>
    <div class="web-preview__viewport">
      <iframe :key="revision" :srcdoc="html" sandbox="allow-scripts" referrerpolicy="no-referrer" :title="t('preview.frame')" :style="{ width: width === 'responsive' ? '100%' : `${width}px` }" />
    </div>
  </section>
</template>

<style scoped>
.web-preview { display: flex; flex-direction: column; min-width: 0; height: 100%; min-height: 200px; }
.web-preview__toolbar { display: flex; align-items: center; gap: 8px; padding: 4px 8px; color: var(--text-muted); border-bottom: 1px solid var(--border); font-size: 12px; }
.web-preview__toolbar select { margin-left: auto; height: 26px; padding: 2px 6px; font-size: 12px; }
.web-preview__toolbar button { display: grid; place-items: center; width: 26px; height: 26px; padding: 0; border: 0; background: transparent; color: var(--text-muted); }
.web-preview__toolbar button:hover { background: var(--surface-subtle); color: var(--text); }
.web-preview__viewport { flex: 1; min-height: 160px; overflow: auto; background: var(--chrome); text-align: center; }
iframe { display: block; max-width: 100%; height: 100%; min-height: 160px; margin: auto; border: 0; background: white; }
</style>
