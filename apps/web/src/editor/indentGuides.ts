// Indentation guides for the editor, following the reference's `editor.guides`
// settings. VS Code draws `.core-guide` elements inside each line; a CodeMirror
// line is a plain block, so the guides are stripes one character apart.
//
// Five rounds of this feature (23–27) failed to make decorations render, and the
// cause turned out to be the *builder*, not the publication path: a set built with
// `RangeSetBuilder` never reached the DOM, while the same ranges built with
// `Decoration.set(ranges, true)` render. The set is therefore built from an array
// here. Two further facts from that trail: the character step is a content
// *attribute* (CodeMirror owns the content element's style), and it has to come
// from the document's own indentation, because CodeMirror's language default
// reports 2 for a Python file using four spaces.

import { StateField, type EditorState, type Extension } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet, type Range } from '@codemirror/view';
import { detectIndentation } from './documentFormat';

/** Deepest nesting that gets its own stripe class; deeper lines reuse the last. */
export const MAX_GUIDE_LEVEL = 12;

/** Visual columns of the leading whitespace, counting a tab as one indent unit. */
export function leadingColumns(text: string, unit: number): number {
  let columns = 0;
  for (const character of text) {
    if (character === ' ') columns += 1;
    else if (character === '\t') columns += unit;
    else break;
  }
  return columns;
}

/** How many guides a line shows: one per indent level it is nested in. */
export function guideLevels(text: string, unit: number): number {
  if (!text.trim()) return -1; // A blank line inherits the block around it.
  return Math.min(MAX_GUIDE_LEVEL, Math.floor(leadingColumns(text, unit) / unit));
}

/** The indent step the file itself uses, in columns. */
export function indentStep(source: string): number {
  return Math.max(2, detectIndentation(source).size);
}

/** The content-attribute declaration carrying `--indent-step`. */
export function stepStyle(source: string): string {
  return `--indent-step: ${indentStep(source)}ch`;
}

// One decoration per depth, interned for the life of the module: CodeMirror
// compares decoration sets by the identity of their values, so reusing them keeps
// an unchanged pass from looking like a change.
const levelDecorations = new Map<number, Decoration>();

function levelDecoration(level: number): Decoration {
  let decoration = levelDecorations.get(level);
  if (!decoration) {
    decoration = Decoration.line({ class: `cm-indent-guides cm-indent-guides-${level}` });
    levelDecorations.set(level, decoration);
  }
  return decoration;
}

export function buildGuides(state: EditorState): DecorationSet {
  const unit = indentStep(state.doc.toString());
  const ranges: Range<Decoration>[] = [];
  let previous = 0;

  for (let number = 1; number <= state.doc.lines; number += 1) {
    const line = state.doc.line(number);
    const level = guideLevels(line.text, unit);
    if (level >= 0) previous = level;
    // A blank line continues the block around it, the way the reference keeps
    // guides running through empty lines.
    const effective = level >= 0 ? level : previous;
    if (effective > 0) {
      ranges.push(levelDecoration(effective).range(line.from));
    }
  }
  return Decoration.set(ranges, true);
}

const guidesField = StateField.define<DecorationSet>({
  create: (state) => buildGuides(state),
  update: (decorations, transaction) => (transaction.docChanged ? buildGuides(transaction.state) : decorations),
  provide: (field) => EditorView.decorations.from(field),
});

/** The step is a content attribute: CodeMirror owns that element's style. */
function stepAttribute(): Extension {
  return EditorView.contentAttributes.compute([], (state) => ({ style: stepStyle(state.doc.toString()) }));
}

export function indentGuides(): Extension {
  return [guidesField, stepAttribute()];
}