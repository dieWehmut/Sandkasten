// Rainbow brackets: the reference colourises matching bracket pairs by nesting
// depth, and `editor.bracketPairColorization.enabled` defaults to **true**, so a
// pair without depth colours is a default-state gap.
//
// Measured from the reference bundle:
//   `bracketPairColorizationOptions: { enabled: true }` is the editor default,
//   the colours cycle through six `editorBracketHighlight.foreground1…6` slots, and
//   `independentColorPoolPerBracketType` defaults to false — every bracket kind
//   draws from the same pool, which is why one depth counter serves them all.
//
// CodeMirror has no depth colouriser, so the depth comes from the syntax tree: a
// bracket's depth is how many bracket nodes enclose it. Only visible ranges are
// walked, which keeps the pass proportional to what is on screen.

import { syntaxTree } from '@codemirror/language';
import { StateField, type EditorState, type Extension, type Range } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';

/** The reference cycles six slots; deeper nesting reuses them. */
export const BRACKET_COLORS = 6;

/**
 * The slots are numbered 1…6, matching the reference's
 * `editorBracketHighlight.foreground1…6`, so a depth of 0 paints slot 1.
 */
export function slotFor(depth: number): number {
  return (Math.max(0, depth) % BRACKET_COLORS) + 1;
}

/**
 * Files past this size keep the plain punctuation colour. A multi-megabyte paste
 * would make the depth walk expensive, and the reference disables colourisation
 * for large files too.
 */
export const MAX_SCAN = 400_000;

export interface BracketMark {
  /** Document offset of the bracket character. */
  pos: number;
  /** Nesting depth, already folded into the colour pool. */
  slot: number;
}

/** Whether a tree node's text is a single bracket character. */
function bracketSlot(text: string): boolean {
  return text.length === 1 && '()[]{}'.includes(text);
}

const OPENERS = '([{';
const CLOSERS = ')]}';

/**
 * Depth-coloured brackets between `from` and `to`.
 *
 * Exported for the unit tests: it is the whole pass, with no view state.
 */
export function bracketMarks(state: EditorState, from: number, to: number): BracketMark[] {
  const marks: BracketMark[] = [];
  const tree = syntaxTree(state);

  // The tree nests *expressions*, not the punctuation, so the brackets are read as
  // leaves in document order and the depth comes from how many openers are still
  // unclosed — the same counter a lexer would keep.
  const openers: string[] = [];

  tree.iterate({
    from: 0,
    to: state.doc.length,
    enter: (node) => {
      // A bracket is a one-character leaf; nothing longer is punctuation.
      if (node.to - node.from !== 1 || node.node.firstChild) return;
      const text = state.doc.sliceString(node.from, node.to);
      const isOpener = OPENERS.includes(text);
      if (!isOpener && !CLOSERS.includes(text)) return;

      // The opener's own depth is how many brackets already enclose it.
      const depth = openers.length - (isOpener ? 0 : 1);
      if (isOpener) {
        openers.push(text);
      } else if (openers.length) {
        openers.pop();
      }

      if (node.from < from || node.from > to) return;
      marks.push({ pos: node.from, slot: slotFor(depth) });
    },
  });
  return marks;
}

const slotDecorations = new Map<number, Decoration>();

function slotDecoration(slot: number): Decoration {
  let decoration = slotDecorations.get(slot);
  if (!decoration) {
    decoration = Decoration.mark({ class: `cm-rainbowBracket cm-rainbowBracket-${slot}` });
    slotDecorations.set(slot, decoration);
  }
  return decoration;
}

export function buildBracketColors(state: EditorState): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  // The whole document is walked rather than the viewport: the set is published
  // from a state field, which cannot see what is on screen, and a file's bracket
  // count is small next to its characters. The guard keeps an enormous pasted file
  // from paying for it.
  if (state.doc.length > MAX_SCAN) return Decoration.none;
  for (const mark of bracketMarks(state, 0, state.doc.length)) {
    ranges.push(slotDecoration(mark.slot).range(mark.pos, mark.pos + 1));
  }
  return Decoration.set(ranges, true);
}

export function bracketColorization(enabled = true): Extension {
  if (!enabled) return [];
  const field = StateField.define<DecorationSet>({
    create: (state) => buildBracketColors(state),
    update: (decorations, transaction) => {
      // The language can change without the text changing, so a reconfigure or a
      // parse completion has to rebuild too.
      if (transaction.docChanged || transaction.effects.length) return buildBracketColors(transaction.state);
      const tree = syntaxTree(transaction.state);
      if (tree !== syntaxTree(transaction.startState)) return buildBracketColors(transaction.state);
      return decorations;
    },
    provide: (field) => EditorView.decorations.from(field),
  });
  return field;
}
