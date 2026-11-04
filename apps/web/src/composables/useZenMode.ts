import { computed, readonly, ref, type DeepReadonly, type Ref } from 'vue';

// Zen mode, measured from the reference workbench rather than invented.
//
// `workbench.action.toggleZenMode` flips a set of independent switches, each backed by
// its own setting, and every one of them defaults to on:
//
//   zenMode.fullScreen            default true   (the Electron host owns this)
//   zenMode.centerLayout          default true
//   zenMode.hideStatusBar         default true
//   zenMode.hideActivityBar       default true
//   zenMode.hideLineNumbers       default true
//   zenMode.restore               default true
//   zenMode.silentNotifications   default true
//   zenMode.showTabs              enum multiple | single | none, default "multiple"
//
// The editor is centred at a measured target width of 900 px with equal margins
// derived from a ratio, not from a fixed inset:
//
//   { targetWidth: 900, leftMarginRatio: .1909, rightMarginRatio: .1909 }
//
// Ratios rather than pixels matters: on a 1440 px window the margin is ~275 px and the
// column is the remaining 900, but on a narrow window the ratio keeps the column
// proportional instead of forcing a 900 px box into a smaller frame. The reference
// does the same, and its `centeredLayoutFixedWidth` default is false, which is exactly
// the "follow the ratio, do not pin the width" behaviour.

/** The reference's centred editor width in CSS pixels. */
export const ZEN_TARGET_WIDTH = 900;

/** The reference's equal left and right margin ratio. */
export const ZEN_MARGIN_RATIO = 0.1909;

/** Which tab-bar treatment Zen mode uses; `showTabs` is an enum, not a boolean. */
export type ZenTabs = 'multiple' | 'single' | 'none';

export interface ZenSettings {
  centerLayout: boolean;
  hideStatusBar: boolean;
  hideActivityBar: boolean;
  hideLineNumbers: boolean;
  showTabs: ZenTabs;
}

/** The shipped defaults: every hide switch on, tabs left at `multiple`. */
export const DEFAULT_ZEN_SETTINGS: ZenSettings = {
  centerLayout: true,
  hideStatusBar: true,
  hideActivityBar: true,
  hideLineNumbers: true,
  showTabs: 'multiple',
};

export interface ZenController {
  active: DeepReadonly<Ref<boolean>>;
  settings: DeepReadonly<Ref<ZenSettings>>;
  /** The centred column's width for a given editor-group width, or null when off. */
  centeredWidth: DeepReadonly<Ref<number | null>>;
  /** The margin either side of the centred column, or 0 when not centring. */
  centeredMargin: DeepReadonly<Ref<number>>;
  /** True when the activity bar should be painted. */
  showActivityBar: DeepReadonly<Ref<boolean>>;
  /** True when the status bar should be painted. */
  showStatusBar: DeepReadonly<Ref<boolean>>;
  /** True when the tab strip should be painted at all. */
  showTabs: DeepReadonly<Ref<boolean>>;
  /** True when the tab strip should collapse to a single entry. */
  singleTab: DeepReadonly<Ref<boolean>>;
  /** Line numbers are hidden only while Zen mode is on. */
  hideLineNumbers: DeepReadonly<Ref<boolean>>;
  /** Reports the editor group's measured width so the centred column can be sized. */
  setContainerWidth(width: number): void;
  toggle(): void;
  exit(): void;
  setSetting<K extends keyof ZenSettings>(key: K, value: ZenSettings[K]): void;
}

/**
 * The margin either side of the centred column for a measured container width.
 *
 * The reference computes the margin from the ratio and then clips the column to the
 * space that is left, so a container narrower than the ratio would leave is filled
 * rather than overhung. A container that cannot fit the 900 px target at the ratio
 * margin still gets the target if it fits, which is why the target is applied first
 * and the ratio only removes what is genuinely spare.
 */
export function zenGeometry(containerWidth: number): { width: number; margin: number } {
  if (!Number.isFinite(containerWidth) || containerWidth <= 0) return { width: 0, margin: 0 };
  // Spare space after reserving the target column; split evenly between both sides.
  const spare = containerWidth - ZEN_TARGET_WIDTH;
  if (spare <= 0) {
    // Too narrow for the target: the column takes the whole width and the ratio
    // contributes nothing, because there is nothing to give away.
    return { width: Math.round(containerWidth), margin: 0 };
  }
  const ratioMargin = Math.floor(containerWidth * ZEN_MARGIN_RATIO);
  const margin = Math.min(ratioMargin, Math.floor(spare / 2));
  return { width: Math.round(containerWidth - margin * 2), margin };
}

export function useZenMode(initial: Partial<ZenSettings> = {}): ZenController {
  const active = ref(false);
  const settings = ref<ZenSettings>({ ...DEFAULT_ZEN_SETTINGS, ...initial });
  const containerWidth = ref(0);

  const geometry = computed(() => zenGeometry(containerWidth.value));

  const centeredWidth = computed(() => (active.value && settings.value.centerLayout ? geometry.value.width : null));
  const centeredMargin = computed(() => (active.value && settings.value.centerLayout ? geometry.value.margin : 0));

  const showActivityBar = computed(() => !(active.value && settings.value.hideActivityBar));
  const showStatusBar = computed(() => !(active.value && settings.value.hideStatusBar));
  const showTabs = computed(() => !(active.value && settings.value.showTabs === 'none'));
  const singleTab = computed(() => active.value && settings.value.showTabs === 'single');
  const hideLineNumbers = computed(() => active.value && settings.value.hideLineNumbers);

  return {
    active: readonly(active),
    settings: readonly(settings),
    centeredWidth,
    centeredMargin,
    showActivityBar,
    showStatusBar,
    showTabs,
    singleTab,
    hideLineNumbers,
    toggle(): void {
      active.value = !active.value;
    },
    exit(): void {
      active.value = false;
    },
    setSetting(key, value): void {
      settings.value = { ...settings.value, [key]: value };
    },
    // The measured width is reported by whatever element actually owns the editor
    // group, so the geometry stays in one place instead of being re-derived per frame.
    setContainerWidth(width: number): void {
      containerWidth.value = width;
    },
  };
}
