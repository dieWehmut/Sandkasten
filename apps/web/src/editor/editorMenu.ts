// The editor's right-click menu. The reference registers its entries in named groups
// whose names carry the sort order, so the sequence is readable straight from the
// bundle rather than being a matter of preference:
//
//   group "1_do"             Undo, Redo                    order 1, 2
//   group "9_cutcopypaste"   Cut, Copy, Paste, Copy As     order 1, 2, 4
//   group "9_select"         Select All                    order 1
//   group "navigation"       Peek (Go to Definition etc.)
//   group "1_modification"   later modification commands
//
// Two things follow. Undo/Redo come *first*, before the clipboard group — this menu
// had them after the selection, which is the order a hand-written menu tends to take
// but not the order the reference shows. And the clipboard group and Select All are
// adjacent groups with no divider lost between them beyond the group boundary itself.
//
// The menu covers what the workbench can actually perform. The reference's
// `navigation` group and its Peek submenu (Go to Definition, Declaration, Type
// Definition, Implementations, References) all depend on a language server, and this
// workbench has none — those entries are deliberately absent rather than present and
// inert, because a menu item that can never act is worse than one that is not there.
// `Copy As` and `Share` are also absent: `Copy As` is populated by extensions at
// runtime, and `Share` opens a share target the desktop shell does not have.

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
    // "1_do" sorts before every other group, so history comes first.
    { kind: 'item', id: 'undo', label: t('editor.undo'), keybinding: `${mod}+Z`, disabled: !state.canUndo },
    { kind: 'item', id: 'redo', label: t('editor.redo'), keybinding: `${mod}+Shift+Z`, disabled: !state.canRedo },
    menuSeparator(),
    // "9_cutcopypaste".
    { kind: 'item', id: 'cut', label: t('editor.cut'), keybinding: `${mod}+X`, disabled: !state.hasSelection },
    { kind: 'item', id: 'copy', label: t('editor.copy'), keybinding: `${mod}+C`, disabled: !state.hasSelection },
    { kind: 'item', id: 'paste', label: t('editor.paste'), keybinding: `${mod}+V`, disabled: !state.canPaste },
    menuSeparator(),
    // "9_select" follows the clipboard group.
    { kind: 'item', id: 'selectAll', label: t('editor.selectAll'), keybinding: `${mod}+A` },
    menuSeparator(),
    // The reference puts find under the editor's own actions rather than in any of
    // the four groups above; keeping it last leaves the measured order intact.
    { kind: 'item', id: 'find', label: t('editor.find'), keybinding: `${mod}+F` },
  ];
}