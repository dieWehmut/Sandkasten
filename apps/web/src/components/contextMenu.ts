// Shared types for the workbench's context menu widget. They live outside the
// component so a builder can describe a menu without importing an SFC.

export interface ContextMenuItem {
  kind: 'item';
  id: string;
  label: string;
  /** Rendered right-aligned, the way VS Code prints the accelerator. */
  keybinding?: string;
  disabled?: boolean;
}

export interface ContextMenuSeparator {
  kind: 'separator';
}

export type ContextMenuEntry = ContextMenuItem | ContextMenuSeparator;

export function menuSeparator(): ContextMenuSeparator {
  return { kind: 'separator' };
}