import { readonly, ref, type DeepReadonly, type Ref } from 'vue';

// The IDE chrome is intentionally thin: one activity at a time, one sidebar,
// one bottom panel. Clicking the active activity collapses the sidebar, which
// matches the editor-first behaviour of the desktop shell.
export type IdeActivity = 'explorer' | 'runs' | 'context';

export interface IdeLayoutController {
  activity: DeepReadonly<Ref<IdeActivity>>;
  sidebarVisible: DeepReadonly<Ref<boolean>>;
  panelVisible: DeepReadonly<Ref<boolean>>;
  panelMaximized: DeepReadonly<Ref<boolean>>;
  // The explorer stacks the workspace tree and the recent runs list; the second
  // list is a collapsible section with a VS Code pane header.
  runsSectionExpanded: DeepReadonly<Ref<boolean>>;
  selectActivity(activity: IdeActivity): void;
  showActivity(activity: IdeActivity): void;
  toggleSidebar(): void;
  togglePanel(): void;
  showPanel(): void;
  togglePanelMaximize(): void;
  toggleRunsSection(): void;
}

export function useIdeLayout(): IdeLayoutController {
  const activity = ref<IdeActivity>('explorer');
  const sidebarVisible = ref(true);
  const panelVisible = ref(true);
  const panelMaximized = ref(false);
  const runsSectionExpanded = ref(true);

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
  };
}
