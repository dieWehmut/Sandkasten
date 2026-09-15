<script setup lang="ts">
import type { Runtime, RuntimeLimits } from '../services/sandkastenApi';
import { useTranslation } from '../i18n/useTranslation';

defineProps<{ runtime?: Runtime }>();
const t = useTranslation();

function fieldLabel(key: string): string {
  return key.replaceAll('_', ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}

function byteLabel(value: number): string {
  const units = ['B', 'KiB', 'MiB', 'GiB'];
  let amount = value;
  let unit = 0;
  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024;
    unit += 1;
  }
  return `${Number.isInteger(amount) ? amount : amount.toFixed(1)} ${units[unit]}`;
}

function limitValue(key: string, value: unknown): string {
  if (typeof value !== 'number') return String(value);
  if (key.endsWith('_timeout_ms')) return value >= 1000 ? `${Number((value / 1000).toFixed(2))} s` : `${value} ms`;
  if (key.endsWith('_bytes') || key === 'memory_limit_bytes') return byteLabel(value);
  return String(value);
}

function limitEntries(limits: RuntimeLimits | undefined): Array<[string, unknown]> {
  return limits ? Object.entries(limits).filter(([, value]) => value !== undefined) : [];
}
</script>

<template>
  <section class="inspector-section" aria-labelledby="runtime-inspector-title">
    <h3 id="runtime-inspector-title">{{ t('inspector.runtime') }}</h3>
    <p v-if="!runtime" class="empty-state">{{ t('inspector.runtimeEmpty') }}</p>
    <dl v-else class="metadata-list">
      <div><dt>{{ t('inspector.language') }}</dt><dd>{{ runtime.language }}</dd></div>
      <div v-if="runtime.version"><dt>{{ t('inspector.version') }}</dt><dd>{{ runtime.version }}</dd></div>
      <div v-if="runtime.image"><dt>{{ t('inspector.image') }}</dt><dd>{{ runtime.image }}</dd></div>
      <div v-if="runtime.status"><dt>{{ t('inspector.status') }}</dt><dd>{{ runtime.status }}</dd></div>
      <div v-if="runtime.default_entrypoint"><dt>{{ t('inspector.entrypoint') }}</dt><dd>{{ runtime.default_entrypoint }}</dd></div>
      <div><dt>{{ t('inspector.vendorRequired') }}</dt><dd>{{ runtime.requires_vendor ? t('inspector.yes') : t('inspector.no') }}</dd></div>
      <div v-if="runtime.aliases?.length"><dt>{{ t('inspector.aliases') }}</dt><dd>{{ runtime.aliases.join(', ') }}</dd></div>
      <div v-if="runtime.compile_phase"><dt>{{ t('inspector.compilePhaseEnabled') }}</dt><dd>{{ runtime.compile_phase.enabled ? t('inspector.yes') : t('inspector.no') }}</dd></div>
      <div v-if="runtime.run_phase"><dt>{{ t('inspector.runPhaseEnabled') }}</dt><dd>{{ runtime.run_phase.enabled ? t('inspector.yes') : t('inspector.no') }}</dd></div>
      <div v-if="runtime.compile_phase?.command?.length"><dt>{{ t('inspector.compileCommand') }}</dt><dd>{{ runtime.compile_phase.command.join(' ') }}</dd></div>
      <div v-if="runtime.run_phase?.command?.length"><dt>{{ t('inspector.runCommand') }}</dt><dd>{{ runtime.run_phase.command.join(' ') }}</dd></div>
    </dl>
    <template v-if="limitEntries(runtime?.default_limits).length">
      <h4>{{ t('inspector.defaultLimits') }}</h4>
      <dl class="metadata-list">
        <div v-for="([key, value]) in limitEntries(runtime?.default_limits)" :key="key"><dt>{{ fieldLabel(key) }}</dt><dd>{{ limitValue(key, value) }}</dd></div>
      </dl>
    </template>
    <template v-if="limitEntries(runtime?.max_limits).length">
      <h4>{{ t('inspector.maximumLimits') }}</h4>
      <dl class="metadata-list">
        <div v-for="([key, value]) in limitEntries(runtime?.max_limits)" :key="key"><dt>{{ fieldLabel(key) }}</dt><dd>{{ limitValue(key, value) }}</dd></div>
      </dl>
    </template>
  </section>
</template>
