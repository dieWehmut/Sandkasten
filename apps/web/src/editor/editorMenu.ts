// The editor's right-click menu. VS Code's editor context menu starts with the
// clipboard actions, then the selection, history, and search commands; this
// builder describes the subset the workbench can actually perform (no language
// server, so no Go to Definition and friends) and marks the entries that are
// unavailable right now.

import type { ContextMenuEntry } from '../components/contextMenu';
import { menuSeparator } from '../components/contextMenu';
import type { Translator } from '../i18n/locale';

export interface EditorMenuState {
  hasSelection: boolean;
  canPaste: boolean;
  canUndo: boolean;
  canRedo: boolean;
  /** 'Ctrl' or 'Cmd', so the accelerator column matches the platform. */
  modifier: string;
}

export type EditorMenuAction = 'cut' | 'copy' | 'paste' | 'selectAll' | 'find' | 'undo' | 'redo';

export function editorMenuEntries(t: Translator, state: EditorMenuState): ContextMenuEntry[] {
  const mod = state.modifier;
  return [
    { kind: 'item', id: 'cut', label: t('editor.cut'), keybinding: `${mod}+X`, disabled: !state.hasSelection },
    { kind: 'item', id: 'copy', label: t('editor.copy'), keybinding: `${mod}+C`, disabled: !state.hasSelection },
    { kind: 'item', id: 'paste', label: t('editor.paste'), keybinding: `${mod}+V`, disabled: !state.canPaste },
    menuSeparator(),
    { kind: 'item', id: 'selectAll', label: t('editor.selectAll'), keybinding: `${mod}+A` },
    menuSeparator(),
    { kind: 'item', id: 'undo', label: t('editor.undo'), keybinding: `${mod}+Z`, disabled: !state.canUndo },
    { kind: 'item', id: 'redo', label: t('editor.redo'), keybinding: `${mod}+Shift+Z`, disabled: !state.canRedo },
    menuSeparator(),
    { kind: 'item', id: 'find', label: t('editor.find'), keybinding: `${mod}+F` },
  ];
}