// Code folding, with the reference's gutter affordance.
//
// VS Code's control lives in the line-number margin:
// `.monaco-editor .margin-view-overlays .codicon-folding-expanded/-collapsed {
//   cursor: pointer; opacity: 0; transition: opacity .5s; display: flex;
//   align-items: center; justify-content: center; font-size: 140%; margin-left: 2px }`
// — a chevron-down while the region is open, a chevron-right while it is folded —
// revealed by `.margin-view-overlays:hover .codicon { opacity: 1 }` and left on
// screen for a folded region. The `140%` codicon size lands at about 12 px, which
// is the glyph size drawn here, and the transition and hover live in editor.css.

import { codeFolding, foldGutter, foldKeymap } from '@codemirror/language';
import type { Extension } from '@codemirror/state';
import { keymap } from '@codemirror/view';

const SVG = 'http://www.w3.org/2000/svg';

// The codicon chevron paths, so the marker keeps the reference's shape rather than
// the text glyphs (`⌄` / `›`) CodeMirror would otherwise draw.
const CHEVRON_DOWN = 'm6 9 6 6 6-6';
const CHEVRON_RIGHT = 'm9 18 6-6-6-6';

// The reference marks a folded range with a bare midline ellipsis after the first
// line: `.inline-folded:after { content: "\22ef"; ... }`. CodeMirror defaults to
// U+2026, which sits on the baseline and reads as a different glyph.
export const FOLD_PLACEHOLDER = '\u22ef';

export function foldMarker(open: boolean): HTMLElement {
  const marker = document.createElement('span');
  marker.className = `cm-foldMarker ${open ? 'cm-foldMarker--open' : 'cm-foldMarker--closed'}`;
  marker.setAttribute('aria-hidden', 'true');
  const svg = document.createElementNS(SVG, 'svg');
  for (const [name, value] of Object.entries({
    viewBox: '0 0 24 24',
    width: '12',
    height: '12',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '2',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
  })) svg.setAttribute(name, value);
  const path = document.createElementNS(SVG, 'path');
  path.setAttribute('d', open ? CHEVRON_DOWN : CHEVRON_RIGHT);
  svg.appendChild(path);
  marker.appendChild(svg);
  return marker;
}

// Folding itself is always on — the keyboard commands need no margin — but the
// chevron column only exists beside the line numbers, which is where the
// reference draws it (`editor.folding` needs `editor.lineNumbers` to have a
// margin at all).
export function foldingExtensions(options: { gutter: boolean }): Extension[] {
  return [
    codeFolding({ placeholderText: FOLD_PLACEHOLDER }),
    keymap.of(foldKeymap),
    options.gutter ? foldGutter({ markerDOM: foldMarker }) : [],
  ];
}
