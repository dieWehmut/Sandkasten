<script setup lang="ts">
import { Monitor, FolderPlus, Folder, Trash2 } from '@lucide/vue';
import { ref } from 'vue';
import type { RemoteHost } from '../../services/desktopBridge';
import type { RemoteExplorerState } from '../../composables/useRemoteHosts';
import { useTranslation } from '../../i18n/useTranslation';

// The view renders the parsed host list and raises the hand-off the shell
// performs. It never talks to the SSH config itself, and the browser build
// explains that it needs the desktop app instead of showing invented hosts.
const props = withDefaults(defineProps<{
  state: RemoteExplorerState;
  available?: boolean;
  hosts?: RemoteHost[];
  configPath?: string;
  error?: string;
  desktop?: boolean;
  busy?: boolean;
}>(), {
  available: true, hosts: () => [], configPath: '', desktop: true, busy: false,
});

const emit = defineEmits<{
  open: [payload: { host: string; directory: string }];
  remember: [payload: { host: string; directory: string }];
  forget: [payload: { host: string; directory: string }];
  refresh: [];
}>();

const t = useTranslation();
const addingFor = ref('');
const draftDirectory = ref('');

function startAdding(alias: string): void {
  addingFor.value = alias;
  draftDirectory.value = '';
}

function submitDirectory(): void {
  const value = draftDirectory.value.trim();
  if (!value || !addingFor.value) return;
  emit('remember', { host: addingFor.value, directory: value });
  addingFor.value = '';
  draftDirectory.value = '';
}

function hostLabel(host: RemoteHost): string {
  const user = host.user ? `${host.user}@` : '';
  const port = host.port ? `:${host.port}` : '';
  return `${user}${host.hostName}${port}`;
}
</script>

<template>
  <section class="ide-remote" data-testid="remote-explorer" :aria-label="t('ide.remote.label')">
    <p v-if="!desktop" class="empty-state ide-remote__hint" data-testid="remote-desktop-only">
      {{ t('ide.remote.desktopOnly') }}
    </p>
    <p v-else-if="error" class="ide-explorer__error" role="alert" data-testid="remote-error">{{ error }}</p>
    <template v-else-if="state === 'loading'">
      <p class="empty-state ide-remote__hint" data-testid="remote-loading">{{ t('ide.remote.loading') }}</p>
    </template>
    <template v-else>
      <p v-if="!available" class="empty-state ide-remote__hint" data-testid="remote-unavailable">
        {{ t('ide.remote.noConfig') }}
      </p>
      <p v-else-if="!hosts.length" class="empty-state ide-remote__hint" data-testid="remote-empty">
        {{ t('ide.remote.empty') }}
      </p>
      <template v-else>
        <p class="ide-remote__group" data-testid="remote-group">{{ t('ide.remote.group') }}</p>
        <ul class="ide-remote__hosts" :aria-label="t('ide.remote.hostsLabel')">
          <li v-for="host in hosts" :key="host.alias" class="ide-remote__host" :data-host="host.alias">
            <span class="ide-remote__row">
              <button
                type="button"
                class="ide-remote__open"
                :data-open="host.alias"
                :title="t('ide.remote.connect')"
                @click="emit('open', { host: host.alias, directory: '' })"
              >
                <Monitor :size="14" aria-hidden="true" />
                <span class="ide-remote__alias">{{ host.alias }}</span>
                <span class="ide-remote__target">{{ hostLabel(host) }}</span>
              </button>
              <button
                type="button"
                class="ide-remote__add"
                data-action="remote-add-directory"
                :data-add="host.alias"
                :aria-label="t('ide.remote.addDirectory')"
                :title="t('ide.remote.addDirectory')"
                @click="startAdding(host.alias)"
              >
                <FolderPlus :size="13" aria-hidden="true" />
              </button>
            </span>
            <form
              v-if="addingFor === host.alias"
              class="ide-remote__form"
              :data-testid="`remote-directory-form-${host.alias}`"
              @submit.prevent="submitDirectory"
            >
              <input
                v-model="draftDirectory"
                data-testid="remote-directory-input"
                type="text"
                name="remoteDirectory"
                autocomplete="off"
                spellcheck="false"
                :placeholder="t('ide.remote.directoryPlaceholder')"
                :aria-label="t('ide.remote.directoryName')"
              >
              <button type="submit">{{ t('ide.remote.add') }}</button>
            </form>
            <ul v-if="host.directories.length" class="ide-remote__directories">
              <li v-for="directory in host.directories" :key="directory" :data-directory="directory">
                <button
                  type="button"
                  class="ide-remote__directory"
                  :title="directory"
                  @click="emit('open', { host: host.alias, directory })"
                >
                  <Folder :size="13" aria-hidden="true" />
                  <span class="ide-remote__directory-name">{{ directory.split('/').filter(Boolean).at(-1) }}</span>
                  <span class="ide-remote__directory-path">{{ directory }}</span>
                </button>
                <button
                  type="button"
                  class="ide-remote__forget"
                  :data-forget="directory"
                  :aria-label="t('ide.remote.forgetDirectory')"
                  :title="t('ide.remote.forgetDirectory')"
                  @click="emit('forget', { host: host.alias, directory })"
                >
                  <Trash2 :size="12" aria-hidden="true" />
                </button>
              </li>
            </ul>
          </li>
        </ul>
        <p class="ide-remote__footer" data-testid="remote-footer">{{ t('ide.remote.terminalHint') }}</p>
      </template>
    </template>
  </section>
</template>
