// Sticky scroll: the reference pins the enclosing scope at the top of the editor
// while you scroll through it. `editor.stickyScroll.enabled` defaults to **on**,
// so its absence is a default-state gap rather than an optional feature.
//
// Measured from the reference stylesheet:
//   `.monaco-editor .sticky-widget { overflow: hidden; width: 100%;
//      border-bottom: 1px solid editorStickyScroll-border;
//      box-shadow: editorStickyScroll-shadow 0 4px 2px -2px; z-index: 4 }`
//   `.sticky-widget-line-numbers { float: left; background-color: …Gutter-background }`
//   `.sticky-line-content { color: editorLineNumber-foreground; white-space: nowrap;
//      display: inline-block; background-color: inherit }`
//   `.sticky-line-content:hover { background-color: …Hover-background; cursor: pointer }`
//   `.sticky-line-number-inner { display: inline-block; text-align: right }`
//
// The reference models the scope with an outline model (a language service).
// There is no language server here, so this tracker walks indentation: a line opens
// a scope for the lines indented under it, which is the same shape for the file
// types this workbench edits.

import { EditorState } from '@codemirror/state';
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { indentStep } from './indentGuides';

export interface StickyScope {
  /** 1-based line number the scope is declared on. */
  line: number;
  /** Visual depth: 0 for a top-level scope. */
  depth: number;
  /** The declaration's text, trimmed. */
  text: string;
}

/** The reference caps the pinned stack at `editor.stickyScroll.maxLineCount` (5). */
export const MAX_STICKY_LINES = 5;

/**
 * Leading whitespace of a line in visual columns, counting a tab as one indent
 * unit. Mirrors `leadingColumns` in indentGuides so both read a file the same way.
 */
export function indentOf(text: string, unit: number): number {
  let columns = 0;
  for (const character of text) {
    if (character === ' ') columns += 1;
    else if (character === '\t') columns += unit;
    else break;
  }
  return columns;
}

/**
 * The scopes enclosing `lineNumber`, outermost first — what the reference pins.
 *
 * A line's own scope does not pin itself: the reference keeps the *enclosing*
 * headers visible, so the stack comes from the nearest shallower ancestors above
 * the line. Blank lines inherit the indentation of the code around them, as the
 * guide pass already does.
 */
export function stickyScopes(
  state: EditorState,
  lineNumber: number,
  unit: number,
  limit = MAX_STICKY_LINES,
): StickyScope[] {
  const total = state.doc.lines;
  const line = Math.max(1, Math.min(total, lineNumber));

  // Walk upwards collecting ancestors: the first shallower non-blank line, then
  // the next one shallower than that, until the document starts.
  const found: StickyScope[] = [];
  let threshold = indentOf(state.doc.line(line).text, unit);
  // A line at column 0 has no ancestor to pin.
  for (let number = line - 1; number >= 1 && found.length < limit; number -= 1) {
    const text = state.doc.line(number).text;
    if (!text.trim()) continue;
    const indentation = indentOf(text, unit);
    if (indentation < threshold) {
      found.push({ line: number, depth: Math.floor(indentation / unit), text: text.trim() });
      threshold = indentation;
      if (indentation === 0) break;
    }
  }
  return found.reverse();
}

/** The topmost visible line, which is what the pinned stack belongs to. */
export function firstVisibleLine(view: EditorView): number {
  // `lineBlockAtHeight` measures from the top of the *content*, so the scroller's
  // own scroll offset has to be added: with a plain `0` it always reports line 1
  // and the stack would never follow the reader.
  const top = Math.max(0, Math.round(view.scrollDOM.scrollTop));
  return view.state.doc.lineAt(view.lineBlockAtHeight(top).from).number;
}

function renderInto(container: HTMLElement, view: EditorView, lineNumber: number): void {
  const unit = indentStep(view.state.doc.toString());
  const scopes = stickyScopes(view.state, lineNumber, unit);
  container.replaceChildren();
  if (!scopes.length) {
    container.hidden = true;
    return;
  }
  container.hidden = false;
  for (const scope of scopes) {
    const row = document.createElement('div');
    row.className = 'cm-stickyLine';
    row.dataset.line = String(scope.line);
    // The reference indents the pinned header by its depth so the nesting reads
    // at a glance, and offers a click back to the declaration.
    row.style.paddingLeft = `${8 + scope.depth * 16}px`;
    row.title = scope.text;
    const number = document.createElement('span');
    number.className = 'cm-stickyLine__number';
    number.textContent = String(scope.line);
    const text = document.createElement('span');
    text.className = 'cm-stickyLine__text';
    text.textContent = scope.text;
    row.append(number, text);
    row.addEventListener('click', () => {
      const line = view.state.doc.line(scope.line);
      view.dispatch({ selection: { anchor: line.from }, effects: EditorView.scrollIntoView(line.from, { y: 'start' }) });
      view.focus();
    });
    container.append(row);
  }
}

/**
 * The pinned header stack. It is a plain element floated over the editor's top
 * edge rather than a CodeMirror panel: the reference's widget is an absolutely
 * positioned overlay (`.sticky-widget` with `z-index: 4`) that does not take part
 * in the content's layout, and a panel here would push the first line down.
 */
export function stickyScroll(): Extension {
  return ViewPlugin.fromClass(class {
    readonly dom: HTMLElement;
    private frame = 0;
    private readonly onScroll = () => this.schedule();

    constructor(private readonly view: EditorView) {
      this.dom = document.createElement('div');
      this.dom.className = 'cm-sticky';
      this.dom.setAttribute('aria-hidden', 'true');
      // The overlay is positioned against the *editor* box, so it belongs beside
      // the scroller rather than inside the content that scrolls away under it.
      view.dom.appendChild(this.dom);
      // A plain scroll does not change CodeMirror's viewport (the rendered range
      // stays inside the viewport), so `update` alone would never fire while the
      // reader scrolls within one screenful — the scroller has to be watched.
      view.scrollDOM.addEventListener('scroll', this.onScroll, { passive: true });
      this.schedule();
    }

    update(update: ViewUpdate): void {
      // Editing, resizing and moving the caret can all change the top line.
      if (update.docChanged || update.viewportChanged || update.geometryChanged || update.selectionSet) this.schedule();
    }

    private schedule(): void {
      if (this.frame) return;
      // The top line is only known after CodeMirror has measured, so the paint is
      // deferred by a frame rather than read mid-update.
      this.frame = requestAnimationFrame(() => {
        this.frame = 0;
        renderInto(this.dom, this.view, firstVisibleLine(this.view));
      });
    }

    destroy(): void {
      this.view.scrollDOM.removeEventListener('scroll', this.onScroll);
      if (this.frame) cancelAnimationFrame(this.frame);
      this.dom.remove();
    }
  });
}
