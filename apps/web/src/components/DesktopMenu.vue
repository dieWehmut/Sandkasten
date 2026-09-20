<script setup lang="ts">
// The integrated desktop title row. Electron runs with a hidden title bar, so
// this component paints the real application menus: a click or ArrowDown asks
// the main process to pop the native menu below the button, and the button
// stays expanded until the OS reports that the menu closed.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { createTranslator, type Translator } from '../i18n/locale';
import type { MessageKey } from '../i18n/messages';
import { WINDOW_MENU_IDS, type WindowChromeBridge, type WindowMenuId } from '../services/desktopBridge';

const props = withDefaults(defineProps<{
  chrome?: WindowChromeBridge;
  locale?: 'en' | 'zh-CN';
  t?: Translator;
}>(), { locale: 'en' });

const englishTranslator = createTranslator('en');
const translate = computed(() => props.t ?? englishTranslator);
const menuKeys: Readonly<Record<WindowMenuId, MessageKey>> = {
  file: 'menu.file',
  edit: 'menu.edit',
  view: 'menu.view',
  help: 'menu.help',
};

const openMenu = ref<WindowMenuId>();
const error = ref('');

function close(): void {
  openMenu.value = undefined;
}

async function toggle(id: WindowMenuId, anchor: HTMLElement): Promise<void> {
  const chrome = props.chrome;
  if (!chrome) return;
  error.value = '';
  if (openMenu.value === id) {
    close();
    return;
  }
  openMenu.value = id;
  const rect = anchor.getBoundingClientRect();
  try {
    // The promise settles when the native menu is dismissed, so the active
    // state tracks the real popup instead of a guessed timeout.
    await chrome.showMenu({ id, x: rect.left, y: rect.bottom, locale: props.locale });
    close();
  } catch (cause) {
    close();
    error.value = translate.value('menu.error');
    console.warn('desktop menu failed', cause);
  }
}

function onKeydown(id: WindowMenuId, event: KeyboardEvent): void {
  // ArrowDown opens the menu like a classic menu bar; Escape closes it.
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    void toggle(id, event.currentTarget as HTMLElement);
  } else if (event.key === 'Escape') {
    event.preventDefault();
    close();
  }
}

function onDocumentClick(event: MouseEvent): void {
  if (!openMenu.value) return;
  const target = event.target as HTMLElement | null;
  if (target?.closest('[data-testid="desktop-menu"]')) return;
  close();
}

onMounted(() => document.addEventListener('click', onDocumentClick));
onBeforeUnmount(() => document.removeEventListener('click', onDocumentClick));
</script>

<template>
  <nav class="desktop-menu" data-testid="desktop-menu" :aria-label="translate('menu.label')">
    <button
      v-for="id in WINDOW_MENU_IDS"
      :key="id"
      type="button"
      class="desktop-menu__button"
      :data-menu="id"
      :aria-expanded="openMenu === id"
      :aria-haspopup="true"
      @click="toggle(id, $event.currentTarget as HTMLElement)"
      @keydown="onKeydown(id, $event)"
    >
      {{ translate(menuKeys[id]) }}
    </button>
    <span v-if="error" class="desktop-menu__error" role="alert">{{ error }}</span>
  </nav>
</template>