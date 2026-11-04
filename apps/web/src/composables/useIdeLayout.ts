import { readonly, ref, type DeepReadonly, type Ref } from 'vue';
import {
  DEFAULT_WORKBENCH_SETTINGS,
  PANEL_MAX_HEIGHT,
  PANEL_MIN_HEIGHT,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
} from '../state/editorSettings';

// The IDE chrome is intentionally thin: one activity at a time, one sidebar,
// one bottom panel. Clicking the active activity collapses the sidebar, which
// matches the editor-first behaviour of the desktop shell.
export type IdeActivity = 'explorer' | 'search' | 'source-control' | 'remote' | 'runs' | 'context';

export interface IdePaneSizes {
  sidebarWidth: number;
  panelHeight: number;
}

export interface IdeLayoutController {
  activity: DeepReadonly<Ref<IdeActivity>>;
  sidebarVisible: DeepReadonly<Ref<boolean>>;
  panelVisible: DeepReadonly<Ref<boolean>>;
  panelMaximized: DeepReadonly<Ref<boolean>>;
  // The explorer stacks the workspace tree and the recent runs list; the second
  // list is a collapsible section with a VS Code pane header.
  runsSectionExpanded: DeepReadonly<Ref<boolean>>;
  // Pane sizes are pixels, owned here so both sashes and the reset command read
  // the same clamped value.
  sidebarWidth: DeepReadonly<Ref<number>>;
  panelHeight: DeepReadonly<Ref<number>>;
  selectActivity(activity: IdeActivity): void;
  showActivity(activity: IdeActivity): void;
  toggleSidebar(): void;
  togglePanel(): void;
  showPanel(): void;
  togglePanelMaximize(): void;
  toggleRunsSection(): void;
  resizeSidebar(width: number): void;
  resizePanel(height: number): void;
  resetPaneSizes(): void;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function useIdeLayout(initial?: Partial<IdePaneSizes> & { sidebarVisible?: boolean; panelVisible?: boolean }): IdeLayoutController {
  const activity = ref<IdeActivity>('explorer');
  const sidebarVisible = ref(initial?.sidebarVisible ?? true);
  const panelVisible = ref(initial?.panelVisible ?? true);
  const panelMaximized = ref(false);
  const runsSectionExpanded = ref(true);
  const sidebarWidth = ref(clamp(initial?.sidebarWidth ?? DEFAULT_WORKBENCH_SETTINGS.sidebarWidth, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH));
  const panelHeight = ref(clamp(initial?.panelHeight ?? DEFAULT_WORKBENCH_SETTINGS.panelHeight, PANEL_MIN_HEIGHT, PANEL_MAX_HEIGHT));

  function selectActivity(next: IdeActivity): void {
    if (activity.value === next && sidebarVisible.value) {
      sidebarVisible.value = false;
      return;
    }
    activity.value = next;
    sidebarVisible.value = true;
  }

  function showActivity(next: IdeActivity): void {
    activity.value = next;
    sidebarVisible.value = true;
  }

  return {
    activity: readonly(activity),
    sidebarVisible: readonly(sidebarVisible),
    panelVisible: readonly(panelVisible),
    panelMaximized: readonly(panelMaximized),
    runsSectionExpanded: readonly(runsSectionExpanded),
    sidebarWidth: readonly(sidebarWidth),
    panelHeight: readonly(panelHeight),
    selectActivity,
    showActivity,
    toggleSidebar: () => { sidebarVisible.value = !sidebarVisible.value; },
    toggleRunsSection: () => { runsSectionExpanded.value = !runsSectionExpanded.value; },
    togglePanel: () => {
      panelVisible.value = !panelVisible.value;
      if (!panelVisible.value) panelMaximized.value = false;
    },
    showPanel: () => { panelVisible.value = true; },
    // Maximizing implies the panel is shown, and hiding it drops the maximized
    // state so the next time it opens it comes back at its normal height.
    togglePanelMaximize: () => {
      panelVisible.value = true;
      panelMaximized.value = !panelMaximized.value;
    },
    resizeSidebar: (width: number) => { sidebarWidth.value = clamp(width, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH); },
    resizePanel: (height: number) => { panelHeight.value = clamp(height, PANEL_MIN_HEIGHT, PANEL_MAX_HEIGHT); },
    // Double-clicking a sash, and the palette's reset command, both return the
    // panes to the reference's defaults rather than to whatever they were when
    // the window opened.
    resetPaneSizes: () => {
      sidebarWidth.value = DEFAULT_WORKBENCH_SETTINGS.sidebarWidth;
      panelHeight.value = DEFAULT_WORKBENCH_SETTINGS.panelHeight;
    },
  };
}
