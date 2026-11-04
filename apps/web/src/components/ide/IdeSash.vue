<script setup lang="ts">
import { ref } from 'vue';

// The reference's splitter: a four-pixel strip on a pane boundary that paints
// `sash-hoverBorder` while hovered or dragged, moves the pane with the pointer,
// and can be driven from the keyboard as a window splitter. Sizes travel as
// absolute values, so the owner of the pane stays the only place that clamps and
// persists them.
const props = withDefaults(defineProps<{
  /** `vertical` splits left/right, `horizontal` splits top/bottom. */
  orientation?: 'vertical' | 'horizontal';
  /** The pane's current size in pixels. */
  value: number;
  min: number;
  max: number;
  /** Accessible name, e.g. "Sidebar size". */
  label: string;
  step?: number;
  largeStep?: number;
}>(), { orientation: 'vertical', step: 10, largeStep: 50 });

const emit = defineEmits<{ resize: [value: number]; reset: [] }>();

const dragging = ref(false);
let origin = 0;
let originValue = 0;

function clamp(next: number): number {
  return Math.min(props.max, Math.max(props.min, Math.round(next)));
}

// A vertical sash sizes the pane on its leading edge, so dragging right grows
// it; a horizontal sash sizes the pane below it, so dragging up grows it.
function offset(event: PointerEvent): number {
  return props.orientation === 'vertical' ? event.clientX - origin : origin - event.clientY;
}

function onPointerDown(event: PointerEvent): void {
  if (event.button !== 0) return;
  dragging.value = true;
  origin = props.orientation === 'vertical' ? event.clientX : event.clientY;
  originValue = props.value;
  (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
  event.preventDefault();
}

function onPointerMove(event: PointerEvent): void {
  if (!dragging.value) return;
  const next = clamp(originValue + offset(event));
  if (next !== props.value) emit('resize', next);
}

function endDrag(event: PointerEvent): void {
  if (!dragging.value) return;
  dragging.value = false;
  (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
}

// Arrow keys move by the small step, Shift by the large one, and Home/End jump
// to the clamp, which is the keyboard contract a window splitter carries.
function onKeydown(event: KeyboardEvent): void {
  const back = props.orientation === 'vertical' ? 'ArrowLeft' : 'ArrowDown';
  const forward = props.orientation === 'vertical' ? 'ArrowRight' : 'ArrowUp';
  const step = event.shiftKey ? props.largeStep : props.step;
  if (event.key === back) emit('resize', clamp(props.value - step));
  else if (event.key === forward) emit('resize', clamp(props.value + step));
  else if (event.key === 'Home') emit('resize', clamp(props.min));
  else if (event.key === 'End') emit('resize', clamp(props.max));
  else return;
  event.preventDefault();
}
</script>

<template>
  <div
    class="ide-sash"
    :class="[`ide-sash--${orientation}`, { 'ide-sash--active': dragging }]"
    role="separator"
    :aria-orientation="orientation"
    :aria-label="label"
    :aria-valuenow="value"
    :aria-valuemin="min"
    :aria-valuemax="max"
    tabindex="0"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="endDrag"
    @pointercancel="endDrag"
    @dblclick="emit('reset')"
    @keydown="onKeydown"
  />
</template>
