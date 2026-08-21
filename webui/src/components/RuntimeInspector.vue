<script setup lang="ts">
import type { Runtime, RuntimeLimits } from '../services/sandkastenApi';

defineProps<{ runtime?: Runtime }>();

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
    <h3 id="runtime-inspector-title">Runtime</h3>
    <p v-if="!runtime" class="empty-state">Choose a runtime to inspect it.</p>
    <dl v-else class="metadata-list">
      <div><dt>Language</dt><dd>{{ runtime.language }}</dd></div>
      <div v-if="runtime.version"><dt>Version</dt><dd>{{ runtime.version }}</dd></div>
      <div v-if="runtime.image"><dt>Image</dt><dd>{{ runtime.image }}</dd></div>
      <div v-if="runtime.status"><dt>Status</dt><dd>{{ runtime.status }}</dd></div>
      <div v-if="runtime.default_entrypoint"><dt>Entrypoint</dt><dd>{{ runtime.default_entrypoint }}</dd></div>
      <div><dt>Vendor required</dt><dd>{{ runtime.requires_vendor ? 'Yes' : 'No' }}</dd></div>
      <div v-if="runtime.aliases?.length"><dt>Aliases</dt><dd>{{ runtime.aliases.join(', ') }}</dd></div>
      <div v-if="runtime.compile_phase"><dt>Compile phase enabled</dt><dd>{{ runtime.compile_phase.enabled ? 'Yes' : 'No' }}</dd></div>
      <div v-if="runtime.run_phase"><dt>Run phase enabled</dt><dd>{{ runtime.run_phase.enabled ? 'Yes' : 'No' }}</dd></div>
      <div v-if="runtime.compile_phase?.command?.length"><dt>Compile command</dt><dd>{{ runtime.compile_phase.command.join(' ') }}</dd></div>
      <div v-if="runtime.run_phase?.command?.length"><dt>Run command</dt><dd>{{ runtime.run_phase.command.join(' ') }}</dd></div>
    </dl>
    <template v-if="limitEntries(runtime?.default_limits).length">
      <h4>Default limits</h4>
      <dl class="metadata-list">
        <div v-for="([key, value]) in limitEntries(runtime?.default_limits)" :key="key"><dt>{{ fieldLabel(key) }}</dt><dd>{{ limitValue(key, value) }}</dd></div>
      </dl>
    </template>
    <template v-if="limitEntries(runtime?.max_limits).length">
      <h4>Maximum limits</h4>
      <dl class="metadata-list">
        <div v-for="([key, value]) in limitEntries(runtime?.max_limits)" :key="key"><dt>{{ fieldLabel(key) }}</dt><dd>{{ limitValue(key, value) }}</dd></div>
      </dl>
    </template>
  </section>
</template>
