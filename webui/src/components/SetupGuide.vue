<script setup lang="ts">
import { computed, useId } from 'vue';
import type { MessageKey } from '../i18n/messages';
import type { Translator } from '../i18n/locale';
import {
  INSTALL_STEPS,
  buildInstallCommand,
  type InstallMode,
  type InstallStep,
  type RuntimePreset,
} from '../setup/installGuide';
import CopyCommand from './CopyCommand.vue';
import InstallModeToggle from './InstallModeToggle.vue';
import '../styles/setup.css';

const props = defineProps<{
  t: Translator;
  mode: InstallMode;
  runtimePreset: RuntimePreset;
}>();

const emit = defineEmits<{
  'update:mode': [mode: InstallMode];
  'update:runtimePreset': [preset: RuntimePreset];
}>();

const runtimeGroupId = useId();
const runtimePresets: readonly RuntimePreset[] = ['core', 'web', 'all'];
const command = computed(() => buildInstallCommand(props.mode, props.runtimePreset));
const stepMessageKeys: Readonly<Record<InstallStep['id'], MessageKey>> = {
  host: 'setup.step.host',
  mode: 'setup.step.select',
  install: 'setup.step.bootstrap',
  services: 'setup.step.provision',
  webui: 'setup.step.webui',
  verify: 'setup.step.verify',
  maintain: 'setup.step.maintain',
};
const visibleSteps = computed(() => INSTALL_STEPS.filter((step) => step.modes.includes(props.mode)));
</script>

<template>
  <section class="setup-guide" data-testid="setup-guide" aria-labelledby="setup-guide-title">
    <div class="setup-guide__heading">
      <p class="eyebrow">{{ t('setup.guide') }}</p>
      <h2 id="setup-guide-title">{{ t('setup.prerequisites') }}</h2>
    </div>

    <ul class="setup-prerequisites" data-testid="setup-prerequisites">
      <li>{{ t('setup.prerequisite.host') }}</li>
      <li>{{ t('setup.prerequisite.privileges') }}</li>
      <li>{{ t('setup.prerequisite.services') }}</li>
      <li>{{ t('setup.prerequisite.network') }}</li>
    </ul>

    <p class="setup-notice setup-notice--warning" data-testid="browser-install-warning" role="note">
      {{ t('setup.warning.browserOnly') }}
    </p>

    <div class="setup-guide__choices">
      <InstallModeToggle
        :model-value="mode"
        :t="t"
        @update:model-value="emit('update:mode', $event)"
      />

      <fieldset class="setup-choice-group" data-testid="runtime-preset-toggle">
        <legend>{{ t('setup.runtimePreset') }}</legend>
        <div class="setup-choice-grid setup-choice-grid--three">
          <label
            v-for="preset in runtimePresets"
            :key="preset"
            class="setup-choice"
            :for="`${runtimeGroupId}-${preset}`"
          >
            <input
              :id="`${runtimeGroupId}-${preset}`"
              :name="`${runtimeGroupId}-runtime-preset`"
              type="radio"
              :value="preset"
              :checked="runtimePreset === preset"
              :data-testid="`runtime-preset-${preset}`"
              @change="emit('update:runtimePreset', preset)"
            >
            <code>{{ preset }}</code>
          </label>
        </div>
      </fieldset>
    </div>

    <div class="setup-command" data-testid="install-command">
      <h3>{{ t('setup.command.bootstrap') }}</h3>
      <CopyCommand
        :command="command"
        :copy-label="t('setup.command.copy')"
        :copied-label="t('setup.command.copied')"
        :failed-label="t('setup.command.copyFailed')"
      />
    </div>

    <ol class="setup-steps" data-testid="install-steps">
      <li v-for="(step, index) in visibleSteps" :key="step.id" data-testid="install-step">
        <span class="setup-step-number" aria-hidden="true">{{ index + 1 }}</span>
        <p>{{ t(stepMessageKeys[step.id]) }}</p>
      </li>
    </ol>

    <aside class="setup-cautions" :aria-label="t('setup.guide')">
      <p>{{ t('setup.warning.publicPages') }}</p>
      <p>{{ t('setup.warning.cors') }}</p>
    </aside>
  </section>
</template>
