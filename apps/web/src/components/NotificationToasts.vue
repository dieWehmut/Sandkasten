<script setup lang="ts">
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from '@lucide/vue';
import type { NotificationKind, Toast } from '../composables/useNotifications';
import { useTranslation } from '../i18n/useTranslation';

// The toast stack, following the measured VS Code notifications: a bottom-right
// stack that sits just above the status bar (`right: 3px; bottom: 25px`), one
// 4 px-margined card per entry with the large corner radius, a 16 px icon column,
// a 22 px message line, a 12 px source line, and a close action revealed on hover
// or keyboard focus. Entries fade and slide in over 300 ms.
withDefaults(defineProps<{ toasts: readonly Toast[] }>(), { toasts: () => [] });
const emit = defineEmits<{ dismiss: [id: string] }>();
const t = useTranslation();

const ICONS: Record<NotificationKind, typeof Info> = {
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  error: CircleAlert,
};
const iconFor = (kind: NotificationKind) => ICONS[kind] ?? Info;
</script>

<template>
  <div
    class="ide-toasts"
    data-testid="notification-toasts"
    role="region"
    :aria-label="t('notifications.label')"
  >
    <p class="ide-toast__sr" aria-live="polite">{{ toasts.at(-1)?.message ?? '' }}</p>
    <article
      v-for="toast in toasts"
      :key="toast.id"
      class="ide-toast"
      :data-kind="toast.kind"
      data-testid="notification-toast"
    >
      <span class="ide-toast__icon" aria-hidden="true">
        <component :is="iconFor(toast.kind)" :size="16" />
      </span>
      <span class="ide-toast__message">{{ toast.message }}</span>
      <span v-if="toast.source" class="ide-toast__source">{{ toast.source }}</span>
      <button
        type="button"
        class="ide-toast__close"
        data-action="dismiss-notification"
        :aria-label="t('notifications.dismiss')"
        :title="t('notifications.dismiss')"
        @click="emit('dismiss', toast.id)"
      >
        <X :size="14" aria-hidden="true" />
      </button>
    </article>
  </div>
</template>