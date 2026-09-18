import { readonly, ref, type DeepReadonly, type Ref } from 'vue';

// The IDE chrome is intentionally thin: one activity at a time, one sidebar,
// one bottom panel. Clicking the active activity collapses the sidebar, which
// matches the editor-first behaviour of the desktop shell.
export type IdeActivity = 'explorer' | 'runs' | 'context';

export interface IdeLayoutController {
  activity: DeepReadonly<Ref<IdeActivity>>;
  sidebarVisible: DeepReadonly<Ref<boolean>>;
  panelVisible: DeepReadonly<Ref<boolean>>;
  selectActivity(activity: IdeActivity): void;
  showActivity(activity: IdeActivity): void;
  toggleSidebar(): void;
  togglePanel(): void;
  showPanel(): void;
}

export function useIdeLayout(): IdeLayoutController {
  const activity = ref<IdeActivity>('explorer');
  const sidebarVisible = ref(true);
  const panelVisible = ref(true);

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
    selectActivity,
    showActivity,
    toggleSidebar: () => { sidebarVisible.value = !sidebarVisible.value; },
    togglePanel: () => { panelVisible.value = !panelVisible.value; },
    showPanel: () => { panelVisible.value = true; },
  };
}