// The tab strip's right-click menu. The reference registers its entries on the
// `editor/title/context` menu in five groups — `1_close`, `1_open`, `3_preview`,
// `5_split`, `7_new_window` — in this order. This builder covers the close family
// plus the two file actions that need no editor groups: Split and Move into New
// Window are absent because there is one editor group and one window here, so
// those rows would do nothing.
//
// The labels are the reference's own, read from `nls.messages.json` of the
// installed build (indices 8456, 8464, 8466, 8458, 8457, 19530, 19550), not a
// paraphrase of them.

import type { ContextMenuEntry } from '../components/contextMenu';
import { menuSeparator } from '../components/contextMenu';
import type { Translator } from '../i18n/locale';

export type TabMenuAction =
  | 'close'
  | 'closeOthers'
  | 'closeRight'
  | 'closeSaved'
  | 'closeAll'
  | 'copyPath'
  | 'reveal';

export interface TabMenuState {
  /** Index of the clicked tab in the strip. */
  index: number;
  total: number;
  /** How many open buffers have unsaved changes. */
  dirtyCount: number;
}

export function tabMenuEntries(t: Translator, state: TabMenuState): ContextMenuEntry[] {
  const { index, total, dirtyCount } = state;
  // A row that cannot act is disabled rather than hidden, which is how the
  // reference presents an unavailable command in a context menu.
  return [
    { kind: 'item', id: 'close', label: t('ide.tabs.closeOne') },
    { kind: 'item', id: 'closeOthers', label: t('ide.tabs.closeOthers'), disabled: total < 2 },
    { kind: 'item', id: 'closeRight', label: t('ide.tabs.closeRight'), disabled: index >= total - 1 },
    { kind: 'item', id: 'closeSaved', label: t('ide.tabs.closeSaved'), disabled: total - dirtyCount < 1 },
    { kind: 'item', id: 'closeAll', label: t('ide.tabs.closeAll') },
    menuSeparator(),
    { kind: 'item', id: 'copyPath', label: t('ide.tabs.copyPath') },
    { kind: 'item', id: 'reveal', label: t('ide.tabs.reveal') },
  ];
}

// Which paths an action closes, split into the buffers that may close straight
// away and the ones that need the discard prompt first. Kept pure and separate
// from the strip so the close semantics are checkable without mounting the
// workbench, and so a bulk action can never silently drop unsaved work.
export interface TabClosePlan {
  /** Buffers the action closes immediately. */
  close: string[];
  /** Dirty buffers the action would close, pending confirmation. */
  ask: string[];
}

export function planTabClose(
  action: TabMenuAction,
  paths: readonly string[],
  active: string,
  dirty: readonly string[],
): TabClosePlan | undefined {
  const index = paths.indexOf(active);
  if (index === -1) return undefined;
  const isDirty = (path: string) => dirty.includes(path);
  let targets: string[];
  switch (action) {
    case 'close': targets = [active]; break;
    case 'closeOthers': targets = paths.filter((path) => path !== active); break;
    case 'closeRight': targets = paths.slice(index + 1); break;
    case 'closeSaved': targets = paths.filter((path) => !isDirty(path)); break;
    case 'closeAll': targets = [...paths]; break;
    default: return undefined;
  }
  return {
    close: targets.filter((path) => !isDirty(path)),
    ask: targets.filter(isDirty),
  };
}
