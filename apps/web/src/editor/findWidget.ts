// The editor's find widget. CodeMirror's built-in search panel is a compact strip
// inside the editor; VS Code's is a 34 px widget floating over the editor's
// top-right corner with icon buttons, three option toggles, a match counter
// ("1 of 3"), and a replace row that expands on demand. This module renders that
// widget on top of the `@codemirror/search` state and commands, so the behaviour
// stays CodeMirror's and only the surface is VS Code's.

import type { EditorState } from '@codemirror/state';
import {
  SearchQuery,
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  replaceAll,
  replaceNext,
  selectMatches,
  setSearchQuery,
} from '@codemirror/search';
import { EditorView, type Panel, type ViewUpdate } from '@codemirror/view';
import { createTranslator, type Translator } from '../i18n/locale';

export interface FindMatchCounts {
  /** Every match the query finds in the document. */
  total: number;
  /** One-based index of the match the selection sits on, or the next one after it. */
  current: number;
}

/**
 * Count the query's matches and report which one the cursor is on, which is what
 * VS Code prints as "current of total". A cursor between matches reports the next
 * match, and a cursor past the last match wraps to the first one.
 */
export function findMatchCounts(state: EditorState, query: SearchQuery): FindMatchCounts {
  if (!query.valid || !query.search) return { total: 0, current: 0 };

  const head = state.selection.main.head;
  const cursor = query.getCursor(state);
  let total = 0;
  let current = 0;
  let following = 0;
  for (let step = cursor.next(); !step.done; step = cursor.next()) {
    total += 1;
    const { from, to } = step.value;
    if (from <= head && head <= to) current = total;
    else if (!following && from > head) following = total;
  }
  return { total, current: current || following || (total ? 1 : 0) };
}

const SVG_NS = 'http://www.w3.org/2000/svg';

// Lucide-style stroked glyphs, inlined so the panel needs no component runtime.
const GLYPHS = {
  chevron: 'M4.5 6.5 8 10 11.5 6.5',
  previous: 'M8 12.5V3.5M4.5 7 8 3.5 11.5 7',
  next: 'M8 3.5v9M4.5 9 8 12.5 11.5 9',
  close: 'M4.5 4.5l7 7M11.5 4.5l-7 7',
  selectAll: 'M5.5 2.5h8v8M2.5 5.5h8v8',
} as const;

function glyph(path: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const shape = document.createElementNS(SVG_NS, 'path');
  shape.setAttribute('d', path);
  shape.setAttribute('fill', 'none');
  shape.setAttribute('stroke', 'currentColor');
  shape.setAttribute('stroke-width', '1.4');
  shape.setAttribute('stroke-linecap', 'round');
  shape.setAttribute('stroke-linejoin', 'round');
  svg.append(shape);
  return svg;
}

type OptionName = 'case' | 'word' | 're';

/** The panel VS Code's find widget replaces, wired to the CodeMirror commands. */
export class FindWidgetPanel implements Panel {
  readonly dom: HTMLElement;
  /** VS Code keeps the widget at the editor's top edge, not at its foot. */
  readonly top = true;

  private readonly view: EditorView;
  private readonly t: Translator;
  private readonly searchInput: HTMLInputElement;
  private readonly replaceInput: HTMLInputElement;
  private readonly count: HTMLElement;
  private readonly replaceRow: HTMLElement;
  private readonly replaceToggle: HTMLButtonElement;
  private readonly options = new Map<OptionName, HTMLButtonElement>();
  private expanded = false;

  constructor(view: EditorView, t: Translator = createTranslator('en')) {
    this.view = view;
    this.t = t;
    this.dom = document.createElement('div');
    this.dom.className = 'find-widget';
    this.dom.setAttribute('role', 'search');

    this.replaceToggle = this.button('find-widget__replace-toggle', t('find.toggleReplace'));
    this.replaceToggle.setAttribute('aria-expanded', 'false');
    this.replaceToggle.append(glyph(GLYPHS.chevron));
    this.replaceToggle.addEventListener('click', () => { this.setExpanded(!this.expanded); });

    const findRow = document.createElement('div');
    findRow.className = 'find-widget__row';

    this.searchInput = this.input('find', t('find.placeholder'));
    this.setQueryValue(this.searchInput, getSearchQuery(view.state).search);
    this.searchInput.addEventListener('input', () => { this.apply(); });
    this.searchInput.addEventListener('keydown', (event) => { this.onInputKeydown(event); });
    findRow.append(this.searchInput);

    this.count = document.createElement('span');
    this.count.className = 'find-widget__count';
    this.count.setAttribute('role', 'status');
    this.count.setAttribute('aria-live', 'polite');
    findRow.append(this.count);

    const previous = this.button('find-widget__button', t('find.previous'));
    previous.append(glyph(GLYPHS.previous));
    previous.addEventListener('click', () => { findPrevious(this.view); });
    const next = this.button('find-widget__button', t('find.next'));
    next.append(glyph(GLYPHS.next));
    next.addEventListener('click', () => { findNext(this.view); });
    findRow.append(previous, next);

    // VS Code labels these toggles with their own glyphs in every locale.
    findRow.append(
      this.option('case', 'Aa', t('find.caseSensitive')),
      this.option('word', 'ab', t('find.wholeWord')),
      this.option('re', '.*', t('find.regexp')),
    );

    const selectAll = this.button('find-widget__button', t('find.selectAll'));
    selectAll.append(glyph(GLYPHS.selectAll));
    selectAll.addEventListener('click', () => { selectMatches(this.view); });
    findRow.append(selectAll);

    const close = this.button('find-widget__button find-widget__button--close', t('find.close'));
    close.append(glyph(GLYPHS.close));
    close.addEventListener('click', () => { closeSearchPanel(this.view); });
    findRow.append(close);

    this.replaceRow = document.createElement('div');
    this.replaceRow.className = 'find-widget__row find-widget__row--replace';
    this.replaceRow.hidden = true;
    this.replaceInput = this.input('replace', t('find.replacePlaceholder'));
    this.setQueryValue(this.replaceInput, getSearchQuery(view.state).replace);
    this.replaceInput.addEventListener('input', () => { this.apply(); });
    this.replaceInput.addEventListener('keydown', (event) => { this.onInputKeydown(event); });
    const replace = this.button('find-widget__button find-widget__button--text', t('find.replace'));
    replace.textContent = t('find.replace');
    replace.addEventListener('click', () => { replaceNext(this.view); });
    const replaceAllButton = this.button('find-widget__button find-widget__button--text', t('find.replaceAll'));
    replaceAllButton.textContent = t('find.replaceAll');
    replaceAllButton.addEventListener('click', () => { replaceAll(this.view); });
    this.replaceRow.append(this.replaceInput, replace, replaceAllButton);

    this.dom.append(this.replaceToggle, findRow, this.replaceRow);
    this.syncOptions(getSearchQuery(view.state));
    this.refresh();
  }

  /** Focus the find field with the current query selected, the way VS Code opens it. */
  mount(): void {
    const query = getSearchQuery(this.view.state);
    if (query.search) this.setQueryValue(this.searchInput, query.search);
    this.setExpanded(Boolean(query.replace));
    this.searchInput.focus();
    this.searchInput.select();
  }

  update(update: ViewUpdate): void {
    const query = getSearchQuery(update.state);
    // Only mirror the query into the fields when the change came from elsewhere,
    // so typing in the widget is never overwritten mid-keystroke.
    if (document.activeElement !== this.searchInput) this.setQueryValue(this.searchInput, query.search);
    if (document.activeElement !== this.replaceInput) this.setQueryValue(this.replaceInput, query.replace);
    this.syncOptions(query);
    this.refresh();
  }

  private input(name: string, label: string): HTMLInputElement {
    const element = document.createElement('input');
    element.className = 'find-widget__input';
    element.type = 'text';
    element.name = name;
    element.setAttribute('aria-label', label);
    element.placeholder = label;
    element.autocomplete = 'off';
    element.spellcheck = false;
    return element;
  }

  private button(className: string, label: string): HTMLButtonElement {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = className;
    element.setAttribute('aria-label', label);
    element.title = label;
    return element;
  }

  private option(name: OptionName, text: string, label: string): HTMLButtonElement {
    const element = this.button('find-widget__option', label);
    element.textContent = text;
    element.setAttribute('aria-pressed', 'false');
    element.addEventListener('click', () => {
      const active = element.getAttribute('aria-pressed') !== 'true';
      element.setAttribute('aria-pressed', String(active));
      this.apply();
    });
    this.options.set(name, element);
    return element;
  }

  private syncOptions(query: SearchQuery): void {
    this.options.get('case')?.setAttribute('aria-pressed', String(query.caseSensitive));
    this.options.get('word')?.setAttribute('aria-pressed', String(query.wholeWord));
    this.options.get('re')?.setAttribute('aria-pressed', String(query.regexp));
  }

  private setExpanded(expanded: boolean): void {
    this.expanded = expanded;
    this.replaceRow.hidden = !expanded;
    this.replaceToggle.setAttribute('aria-expanded', String(expanded));
    this.replaceToggle.classList.toggle('find-widget__replace-toggle--expanded', expanded);
  }

  private setQueryValue(input: HTMLInputElement, value: string): void {
    if (input.value !== value) input.value = value;
  }

  private spec(): { search: string; replace: string; caseSensitive: boolean; wholeWord: boolean; regexp: boolean } {
    return {
      search: this.searchInput.value,
      replace: this.replaceInput.value,
      caseSensitive: this.options.get('case')?.getAttribute('aria-pressed') === 'true',
      wholeWord: this.options.get('word')?.getAttribute('aria-pressed') === 'true',
      regexp: this.options.get('re')?.getAttribute('aria-pressed') === 'true',
    };
  }

  private apply(): void {
    this.view.dispatch({ effects: setSearchQuery.of(new SearchQuery(this.spec())) });
    this.refresh();
  }

  private refresh(): void {
    const query = getSearchQuery(this.view.state);
    const { total, current } = findMatchCounts(this.view.state, query);
    this.count.classList.toggle('find-widget__count--empty', total === 0 && Boolean(query.search));
    this.count.textContent = total === 0
      ? (query.search ? this.t('find.noResults') : '')
      : this.t('find.count').replace('{current}', String(current)).replace('{total}', String(total));
  }

  private onInputKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (event.shiftKey) findPrevious(this.view);
    else findNext(this.view);
  }
}