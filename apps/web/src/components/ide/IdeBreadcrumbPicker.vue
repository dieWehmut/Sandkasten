<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { BreadcrumbEntry } from '../../editor/breadcrumbs';
import type { IconTheme } from '../../editor/fileIcon';
import { useTranslation } from '../../i18n/useTranslation';
import FileIcon from '../FileIcon.vue';

// The dropdown a breadcrumb opens, following the measured VS Code picker: an
// upward arrow pointing at the step, a 36 px filter row (`padding: 5px 9px`), and
// 22 px entries whose matching part is bolded. Entries are the siblings of the
// step that was clicked, so the trail can be walked sideways.
const props = withDefaults(defineProps<{
  open: boolean;
  entries: readonly BreadcrumbEntry[];
  activePath?: string;
  /** Anchor point in viewport coordinates (the step's bottom-left corner). */
  x?: number;
  y?: number;
  /** Where the arrow sits inside the widget, measured from its left edge. */
  arrowOffset?: number;
  label: string;
  iconTheme?: IconTheme;
}>(), { activePath: '', x: 0, y: 0, arrowOffset: 16, iconTheme: 'dark' });

const emit = defineEmits<{ select: [entry: BreadcrumbEntry]; close: [] }>();

const t = useTranslation();
const picker = ref<HTMLElement>();
const filter = ref<HTMLInputElement>();
const query = ref('');
const active = ref(0);
const position = ref({ left: 0, top: 0 });
const placed = ref(false);

const matches = computed(() => {
  const needle = query.value.trim().toLocaleLowerCase();
  if (!needle) return props.entries;
  return props.entries.filter((entry) => entry.name.toLocaleLowerCase().includes(needle));
});

/** The parts of a name around the filter text, so the match can be bolded. */
function parts(name: string): { before: string; match: string; after: string } {
  const needle = query.value.trim();
  const at = needle ? name.toLocaleLowerCase().indexOf(needle.toLocaleLowerCase()) : -1;
  if (at < 0) return { before: name, match: '', after: '' };
  return { before: name.slice(0, at), match: name.slice(at, at + needle.length), after: name.slice(at + needle.length) };
}

function choose(index: number): void {
  const entry = matches.value[index];
  if (entry) emit('select', entry);
}

function move(step: 1 | -1): void {
  const total = matches.value.length;
  if (!total) return;
  active.value = ((active.value + step) % total + total) % total;
}

function onKeydown(event: KeyboardEvent): void {
  if (!['ArrowDown', 'ArrowUp', 'Enter', 'Escape', 'Tab'].includes(event.key)) return;
  event.preventDefault();
  event.stopPropagation();
  if (event.key === 'Escape' || event.key === 'Tab') { emit('close'); return; }
  if (event.key === 'Enter') { choose(active.value); return; }
  move(event.key === 'ArrowDown' ? 1 : -1);
}

function onPointerdown(event: PointerEvent): void {
  if (props.open && event.target instanceof Node && !picker.value?.contains(event.target)) emit('close');
}
onMounted(() => document.addEventListener('pointerdown', onPointerdown, true));
onBeforeUnmount(() => document.removeEventListener('pointerdown', onPointerdown, true));

async function place(): Promise<void> {
  placed.value = false;
  await nextTick();
  const element = picker.value;
  if (!element) return;
  const margin = 4;
  const box = element.getBoundingClientRect();
  position.value = {
    left: Math.min(Math.max(props.x, margin), Math.max(margin, window.innerWidth - box.width - margin)),
    top: Math.min(Math.max(props.y, margin), Math.max(margin, window.innerHeight - box.height - margin)),
  };
  placed.value = true;
}

watch(() => props.open, async (open) => {
  if (!open) { placed.value = false; return; }
  query.value = '';
  active.value = Math.max(0, props.entries.findIndex((entry) => entry.path === props.activePath));
  await place();
  filter.value?.focus();
}, { immediate: true });

watch(matches, () => { active.value = 0; });
</script>

<template>
  <div
    v-if="open"
    ref="picker"
    class="ide-breadcrumb-picker"
    :class="{ 'ide-breadcrumb-picker--placed': placed }"
    :style="{ left: `${position.left}px`, top: `${position.top}px` }"
    role="dialog"
    :aria-label="label"
    data-testid="breadcrumb-picker"
    @keydown="onKeydown"
  >
    <span class="ide-breadcrumb-picker__arrow" :style="{ left: `${arrowOffset}px` }" aria-hidden="true" />
    <div class="ide-breadcrumb-picker__filter">
      <input
        ref="filter"
        v-model="query"
        type="text"
        class="ide-breadcrumb-picker__input"
        :aria-label="t('ide.breadcrumbs.filter')"
        :placeholder="t('ide.breadcrumbs.filter')"
        autocomplete="off"
        spellcheck="false"
      >
    </div>
    <ul class="ide-breadcrumb-picker__list" role="listbox" :aria-label="label">
      <li v-for="(entry, index) in matches" :key="entry.path">
        <button
          type="button"
          class="ide-breadcrumb-picker__item"
          role="option"
          :data-path="entry.path"
          :aria-selected="index === active"
          :aria-current="entry.path === activePath ? 'true' : undefined"
          @pointermove="active = index"
          @click="choose(index)"
        >
          <FileIcon
            :path="entry.path"
            :name="entry.name"
            :kind="entry.kind === 'directory' ? 'folder' : 'file'"
            expanded
            :theme="iconTheme"
            :size="15"
          />
          <span class="ide-breadcrumb-picker__name">
            {{ parts(entry.name).before }}<mark v-if="parts(entry.name).match">{{ parts(entry.name).match }}</mark>{{ parts(entry.name).after }}
          </span>
        </button>
      </li>
    </ul>
    <p v-if="!matches.length" class="ide-breadcrumb-picker__empty" role="status">{{ t('ide.breadcrumbs.noMatch') }}</p>
  </div>
</template>