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
  buildOperationalCommands,
} from '../setup/installGuide';
import CopyCommand from './CopyCommand.vue';
import InstallModeToggle from './InstallModeToggle.vue';
import InstallStepList from './InstallStepList.vue';
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
const stepTitleMessageKeys: Readonly<Record<InstallStep['id'], MessageKey>> = {
  host: 'setup.step.title.host',
  mode: 'setup.step.title.select',
  install: 'setup.step.title.bootstrap',
  services: 'setup.step.title.provision',
  webui: 'setup.step.title.webui',
  verify: 'setup.step.title.verify',
  maintain: 'setup.step.title.maintain',
};
const visibleSteps = computed(() => INSTALL_STEPS.filter((step) => step.modes.includes(props.mode)));
const operationalCommands = computed(() => buildOperationalCommands(props.mode, props.runtimePreset));
const commandLabels: Record<ReturnType<typeof buildOperationalCommands>[number]['id'], MessageKey> = {
  repository: 'setup.command.repository',
  verify: 'setup.command.verify',
  status: 'setup.command.status',
  restart: 'setup.command.restart',
  languages: 'setup.command.languages',
  reconfigure: 'setup.command.reconfigure',
  domain: 'setup.command.domain',
  uninstall: 'setup.command.uninstall',
};
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

    <InstallStepList
      :steps="visibleSteps.map((step) => ({ ...step, title: t(stepTitleMessageKeys[step.id]), description: t(stepMessageKeys[step.id]) }))"
      :mode="mode"
    />

    <section class="setup-operations" data-testid="operational-commands">
      <h3>{{ t('setup.command.operations') }}</h3>
      <div v-for="operation in operationalCommands" :key="operation.id" class="setup-command setup-command--operation">
        <h4>{{ t(commandLabels[operation.id]) }}</h4>
        <CopyCommand
          :command="operation.command"
          :copy-label="t('setup.command.copy')"
          :copied-label="t('setup.command.copied')"
          :failed-label="t('setup.command.copyFailed')"
        />
      </div>
    </section>

    <aside class="setup-cautions" :aria-label="t('setup.guide')">
      <p>{{ t('setup.warning.publicPages') }}</p>
      <p>{{ t('setup.warning.cors') }}</p>
    </aside>
  </section>
</template>
