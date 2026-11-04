import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import type { Extension } from '@codemirror/state';

/**
 * The shadow the reference draws along a scrolled edge.
 *
 * Measured from `workbench.desktop.main.css`:
 *
 *   `.monaco-scrollable-element>.shadow{position:absolute;display:none}`
 *   `.monaco-scrollable-element>.shadow.top{display:block;top:0;left:3px;
 *     height:3px;width:100%;box-shadow:var(--vscode-scrollbar-shadow) 0 6px 6px -6px inset}`
 *   `.monaco-scrollable-element>.shadow.left{display:block;top:3px;left:0;
 *     height:100%;width:3px;box-shadow:var(--vscode-scrollbar-shadow) 6px 0 6px -6px inset}`
 *
 * So each edge is a 3 px band with an inset shadow that only appears once the
 * content has scrolled away from that edge. The colour is `scrollbar.shadow`
 * (`#000000` dark, `#DDDDDD` light); this module applies the token instead of the
 * literal so both themes and all five schemes stay correct.
 *
 * The band is an overlay on the editor box rather than part of the scroller, for
 * the same reason the sticky-scroll widget is: it must stay put while the content
 * moves underneath it.
 */
/**
 * Whether an edge band is visible, given that axis's scroll offset.
 *
 * The reference's shadow elements are `display: none` and are switched to
 * `display: block` by the scrollable element once the content has moved away
 * from that edge, so a fractional offset counts as scrolled.
 */
export function showsShadow(offset: number): boolean {
  return offset > 0;
}

export function scrollShadows(): Extension {
  return ViewPlugin.fromClass(class {
    readonly dom: HTMLElement;
    private frame = 0;
    private readonly onScroll = () => this.schedule();

    constructor(private readonly view: EditorView) {
      this.dom = document.createElement('div');
      this.dom.className = 'cm-scroll-shadows';
      this.dom.setAttribute('aria-hidden', 'true');
      const top = document.createElement('i');
      top.className = 'cm-scroll-shadow cm-scroll-shadow--top';
      const left = document.createElement('i');
      left.className = 'cm-scroll-shadow cm-scroll-shadow--left';
      this.dom.append(top, left);
      // Positioned against the editor box, beside the scroller.
      view.dom.appendChild(this.dom);
      // A scroll within one screenful does not change the viewport, so `update`
      // alone never fires while the reader scrolls; the scroller has to be watched.
      view.scrollDOM.addEventListener('scroll', this.onScroll, { passive: true });
      this.schedule();
    }

    update(update: ViewUpdate): void {
      if (update.docChanged || update.geometryChanged) this.schedule();
    }

    private schedule(): void {
      if (this.frame) return;
      this.frame = requestAnimationFrame(() => {
        this.frame = 0;
        const { scrollTop, scrollLeft } = this.view.scrollDOM;
        // The reference shows each band only once the content has moved off that
        // edge, which is why the same element carries the shadow conditionally.
        this.dom.classList.toggle('is-scrolled-top', showsShadow(scrollTop));
        this.dom.classList.toggle('is-scrolled-left', showsShadow(scrollLeft));
      });
    }

    destroy(): void {
      this.view.scrollDOM.removeEventListener('scroll', this.onScroll);
      if (this.frame) cancelAnimationFrame(this.frame);
      this.dom.remove();
    }
  });
}
