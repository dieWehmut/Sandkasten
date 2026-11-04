// Shared types for the workbench's context menu widget. They live outside the
// component so a builder can describe a menu without importing an SFC.

export interface ContextMenuItem {
  kind: 'item';
  id: string;
  label: string;
  /** Rendered right-aligned, the way VS Code prints the accelerator. */
  keybinding?: string;
  disabled?: boolean;
  /**
   * An item the reference renders with a tick, for state that is a toggle rather
   * than an action — the pin/unpin pair on a tab is the only one here today.
   */
  checked?: boolean;
}

export interface ContextMenuSeparator {
  kind: 'separator';
}

export type ContextMenuEntry = ContextMenuItem | ContextMenuSeparator;

export function menuSeparator(): ContextMenuSeparator {
  return { kind: 'separator' };
}