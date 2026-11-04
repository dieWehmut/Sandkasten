// Whitespace rendering.
//
// Measured from the reference: `editor.renderWhitespace` defaults to
// **`"selection"`** — "Render whitespace characters only on selected text"
// (nls 652) — over the enum `["none","boundary","selection","trailing","all"]`
// ("Render whitespace characters except for single spaces between words",
// "Render only trailing whitespace characters", and "" for the two ends).
//
// The editor previously rendered no whitespace at all, so selecting a run of
// indentation looked like empty space. CodeMirror's own `highlightWhitespace()`
// only offers the "all" behaviour (it marks every tab and space), so the modes are
// implemented here: the decorations are rebuilt when the selection changes, which
// is what makes `selection` mode show markers only inside the selected range.

import { StateField, type EditorState, type Extension, type Range } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';

/** The reference's five modes, in its own order. */
export const RENDER_WHITESPACE_MODES = ['none', 'boundary', 'selection', 'trailing', 'all'] as const;
export type RenderWhitespaceMode = (typeof RENDER_WHITESPACE_MODES)[number];

/** The reference's default: markers appear only inside the selection. */
export const DEFAULT_RENDER_WHITESPACE: RenderWhitespaceMode = 'selection';

export function isRenderWhitespaceMode(value: unknown): value is RenderWhitespaceMode {
  return typeof value === 'string' && (RENDER_WHITESPACE_MODES as readonly string[]).includes(value);
}

export interface WhitespaceMark {
  pos: number;
  /** A tab is drawn differently from a space in the reference. */
  tab: boolean;
}

function isSelected(state: EditorState, pos: number): boolean {
  for (const range of state.selection.ranges) {
    if (range.empty) continue;
    if (pos >= range.from && pos < range.to) return true;
  }
  return false;
}

function trailingStart(text: string): number {
  let index = text.length;
  while (index > 0 && (text[index - 1] === ' ' || text[index - 1] === '\t')) index -= 1;
  return index;
}

/** A space with non-space text on both sides and no adjacent whitespace. */
function isSingleSpaceBetweenWords(text: string, index: number): boolean {
  if (index === 0 || index + 1 >= text.length) return false;
  const before = text[index - 1];
  const after = text[index + 1];
  return /\S/.test(before) && /\S/.test(after);
}

/**
 * Every whitespace character that should show a marker between `from` and `to`.
 *
 * Exported for the unit tests: it is the whole decision, with no view state.
 */
export function whitespaceMarks(
  state: EditorState,
  from: number,
  to: number,
  mode: RenderWhitespaceMode,
): WhitespaceMark[] {
  if (mode === 'none') return [];
  const marks: WhitespaceMark[] = [];

  for (let number = state.doc.lineAt(from).number; number <= state.doc.lineAt(to).number; number += 1) {
    const line = state.doc.line(number);
    const text = line.text;
    const tail = trailingStart(text);

    for (let index = 0; index < text.length; index += 1) {
      const character = text[index];
      if (character !== ' ' && character !== '\t') continue;
      const pos = line.from + index;
      if (pos < from || pos > to) continue;

      let show: boolean;
      switch (mode) {
        case 'all':
          show = true;
          break;
        // "except for single spaces between words": hide a space only when it is a
        // lone separator with text on both sides. Any run of two or more, and any
        // leading or trailing whitespace, still shows.
        case 'boundary':
          show = character === '\t' ? true : !isSingleSpaceBetweenWords(text, index);
          break;
        case 'trailing':
          show = index >= tail;
          break;
        case 'selection':
          show = isSelected(state, pos);
          break;
        default:
          show = false;
      }
      if (show) marks.push({ pos, tab: character === '\t' });
    }
  }
  return marks;
}

const spaceDecoration = Decoration.mark({ class: 'cm-renderSpace' });
const tabDecoration = Decoration.mark({ class: 'cm-renderTab' });

export function buildWhitespaceDecorations(state: EditorState, mode: RenderWhitespaceMode): DecorationSet {
  // Built from an array and published with `Decoration.set`, exactly as the
  // indentation guides are: a `RangeSetBuilder` set does not reach the DOM through
  // a state field here.
  const ranges: Range<Decoration>[] = [];
  for (const mark of whitespaceMarks(state, 0, state.doc.length, mode)) {
    ranges.push((mark.tab ? tabDecoration : spaceDecoration).range(mark.pos, mark.pos + 1));
  }
  return Decoration.set(ranges, true);
}

export function renderWhitespace(mode: RenderWhitespaceMode = DEFAULT_RENDER_WHITESPACE): Extension {
  if (mode === 'none') return [];
  const field = StateField.define<DecorationSet>({
    create: (state) => buildWhitespaceDecorations(state, mode),
    update: (decorations, transaction) => {
      // `selection` mode is defined by the selection, so it has to rebuild as the
      // selection moves; the other modes only follow the document.
      if (transaction.docChanged) return buildWhitespaceDecorations(transaction.state, mode);
      if (mode === 'selection' && transaction.selection) return buildWhitespaceDecorations(transaction.state, mode);
      return decorations;
    },
    provide: (field) => EditorView.decorations.from(field),
  });
  return field;
}
