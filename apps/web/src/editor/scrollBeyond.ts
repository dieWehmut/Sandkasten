// Scroll beyond the last line.
//
// The setting is measured: `editor.scrollBeyondLastLine` registers as
// `new Ra(120, "scrollBeyondLastLine", !0, { description: d(672, null) })`, so its
// default is `true` and nls 672 is "Controls whether the editor will scroll beyond
// the last line". `editor.padding.bottom` stays at its default of 0, so the space
// below the last line comes from the scroll range rather than from padding.
//
// How much range, measured precisely: `y = paddingBottom / lineHeight` and, when
// the setting is on, `y = Math.max(y, n / v - 1)` where `n` is the editor height
// and `v` the line height — that is, the trailing gap is the **viewport minus one
// line**, not a full viewport. The distinction matters at the margin: a full
// viewport would let the last line clear the top edge entirely and leave a blank
// screen below it, while viewport-minus-one leaves exactly one line of context.
//
// One caveat about the source of that formula, recorded because an earlier revision
// of this comment overstated it. The `n / v - 1` expression lives in
// `computeContainedMinimapLineCount`, and every one of the bundle's
// `scrollBeyondLastLine` consumers is either that minimap calculation or the
// notebook's own `_allowScrollBeyondLastLine()`. The plain editor's scroll range is
// computed in the Monaco core layer, which is not separately inspectable here. What
// is verified is the setting's default, its documented meaning, and the
// viewport-minus-one arithmetic the minimap path uses; the spacer below reproduces
// that arithmetic, and a browser probe confirms the resulting behaviour.
//
// CodeMirror stops at the last line, so the extra range is added by a spacer whose
// height is the scroll port's remaining height. The last line is then reachable at
// the top of the editor, which is what makes "put the end of the file at the top
// of the screen" work while typing near the bottom.

import { type Extension } from '@codemirror/state';
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';

/** The class on the spacer that reserves the trailing range. */
export const BEYOND_SPACER_CLASS = 'cm-scrollBeyondSpacer';

/**
 * Adds the extra scroll range as an absolutely positioned spacer.
 *
 * The obvious implementation — a trailing `padding-bottom` on the scroller — does
 * not work, and the way it fails is worth recording. CodeMirror *reads* the
 * scroller's vertical padding: `parseInt(style.paddingBottom)` is folded into its own
 * `paddingBottom`, which is then flagged as a geometry and height change. So the
 * trailer is laid out as part of the content and re-measures the view. A measured
 * six-line file in a 533 px port with a 533 px trailer produced a `scrollHeight` of
 * 893 — a 360 px range — and, scrolled to the end, left the last line **243 px above**
 * the port's top edge. The range was consumed moving the content, not extending it.
 *
 * Appending to `.cm-content` fails for the other reason: CodeMirror rebuilds that
 * element's children on every update, so an added node is discarded.
 *
 * An absolutely positioned spacer inside the scroller avoids both. It cannot be
 * re-flowed because it takes part in no flow, it cannot be removed by a content
 * rebuild because it is not a content child, and it still contributes to the
 * scroller's `scrollHeight`, which is exactly the range the reference reserves.
 */
export function scrollBeyondLastLine(enabled = true): Extension {
  if (!enabled) return [];
  return ViewPlugin.fromClass(class {
    private frame = 0;
    private readonly spacer: HTMLElement;
    private readonly onScroll = () => this.measure();

    constructor(private readonly view: EditorView) {
      this.spacer = document.createElement('div');
      this.spacer.className = BEYOND_SPACER_CLASS;
      this.spacer.setAttribute('aria-hidden', 'true');
      view.scrollDOM.appendChild(this.spacer);
      view.scrollDOM.addEventListener('scroll', this.onScroll, { passive: true });
      this.measure();
    }

    update(update: ViewUpdate): void {
      if (update.docChanged || update.geometryChanged || update.viewportChanged) this.measure();
    }

    private measure(): void {
      if (this.frame) return;
      this.frame = requestAnimationFrame(() => {
        this.frame = 0;
        const lineHeight = this.view.defaultLineHeight || 0;
        const extra = this.shortfall(lineHeight);
        this.spacer.style.height = extra ? `${extra}px` : '0px';
      });
    }

    /**
     * How much range is missing for the last line to reach the port's top edge.
     *
     * This reads the last line's real position instead of computing one from
     * `view.contentHeight`. The two disagree: for a six-line file `contentHeight`
     * reports 166 px while the last line's top sits 117 px down, a 49 px gap that is
     * the line itself plus document padding. Deriving the offset from
     * `contentHeight - lineHeight` therefore overshot by 28 px and let the last line
     * scroll past the top edge. The DOM knows the answer directly, so ask it.
     */
    private shortfall(lineHeight: number): number {
      const scroller = this.view.scrollDOM;
      const port = scroller.clientHeight;
      if (!port || lineHeight <= 0) return 0;

      // Where the last line's top sits relative to the top of the scrollable content,
      // independent of the current scroll position.
      const contentTop = this.view.contentDOM.getBoundingClientRect().top;
      const lastLine = this.view.contentDOM.lastElementChild;
      let lastLineOffset: number;
      if (lastLine) {
        lastLineOffset = lastLine.getBoundingClientRect().top - contentTop;
      } else {
        // A viewport-only render may not include the final line; fall back to the
        // arithmetic offset, which is exact when no padding is in play.
        lastLineOffset = Math.max(0, this.view.contentHeight - lineHeight);
      }

      // The range already available without the spacer.
      const naturalRange = Math.max(0, scroller.scrollHeight - this.spacer.offsetHeight - port);
      return Math.max(0, Math.round(lastLineOffset - naturalRange));
    }

    destroy(): void {
      this.view.scrollDOM.removeEventListener('scroll', this.onScroll);
      if (this.frame) cancelAnimationFrame(this.frame);
      this.spacer.remove();
    }
  });
}
