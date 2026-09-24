import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { describe, expect, test } from 'vitest';
import { EditorState } from '@codemirror/state';
import { SearchQuery, openSearchPanel, searchPanelOpen } from '@codemirror/search';
import type { EditorView } from '@codemirror/view';
import SourceEditor from '../src/components/SourceEditor.vue';
import { findMatchCounts } from '../src/editor/findWidget';

function stateWith(doc: string, anchor = 0): EditorState {
  return EditorState.create({ doc, selection: { anchor } });
}

describe('find widget match counting', () => {
  test('counts every match and reports the one the cursor sits on', () => {
    const doc = 'alpha\nbeta\nalpha\n';
    // The cursor on the first match, then on the second one.
    expect(findMatchCounts(stateWith(doc, 0), new SearchQuery({ search: 'alpha' }))).toEqual({ total: 2, current: 1 });
    expect(findMatchCounts(stateWith(doc, 11), new SearchQuery({ search: 'alpha' }))).toEqual({ total: 2, current: 2 });
    // A cursor between matches reports the next one, and one past the last match
    // wraps around to the first, which is what VS Code prints after a find.
    expect(findMatchCounts(stateWith(doc, 6), new SearchQuery({ search: 'alpha' }))).toEqual({ total: 2, current: 2 });
    expect(findMatchCounts(stateWith(doc, doc.length), new SearchQuery({ search: 'alpha' }))).toEqual({ total: 2, current: 1 });
  });

  test('respects the option toggles and stays quiet without a query', () => {
    const doc = 'Alpha\nalpha\n';
    expect(findMatchCounts(stateWith(doc), new SearchQuery({ search: 'alpha' }))).toEqual({ total: 2, current: 1 });
    expect(findMatchCounts(stateWith(doc), new SearchQuery({ search: 'alpha', caseSensitive: true }))).toEqual({ total: 1, current: 1 });
    // Whole-word and regular-expression switches change what counts.
    expect(findMatchCounts(stateWith('a\naa\n'), new SearchQuery({ search: 'a', wholeWord: true }))).toEqual({ total: 1, current: 1 });
    expect(findMatchCounts(stateWith(doc), new SearchQuery({ search: 'a+' }))).toEqual({ total: 0, current: 0 });
    expect(findMatchCounts(stateWith(doc), new SearchQuery({ search: 'a+', regexp: true }))).toEqual({ total: 4, current: 1 });
    expect(findMatchCounts(stateWith(doc), new SearchQuery({ search: '[' , regexp: true }))).toEqual({ total: 0, current: 0 });
    expect(findMatchCounts(stateWith(doc), new SearchQuery({ search: '' }))).toEqual({ total: 0, current: 0 });
  });
});

describe('find widget panel', () => {
  function mountWithPanel() {
    // Two lowercase matches and one uppercase one, so the case toggle matters.
    const wrapper = mount(SourceEditor, { props: { modelValue: 'alpha\nbeta\nAlpha\n', language: 'python' } });
    const view = wrapper.vm.editorView as EditorView;
    openSearchPanel(view);
    return { wrapper, view };
  }

  test('floats over the editor with the VS Code controls', () => {
    const { wrapper } = mountWithPanel();

    const panels = wrapper.get('.cm-panels-top');
    expect(panels.find('.find-widget').exists()).toBe(true);
    expect(wrapper.get('.find-widget__input[name="find"]').attributes('placeholder')).toBe('Find');
    // Icon buttons plus the three option toggles VS Code labels Aa / ab / .*.
    for (const label of ['Previous Match', 'Next Match', 'Select All Matches', 'Close Find Widget', 'Toggle Replace']) {
      expect(wrapper.find(`.find-widget [aria-label="${label}"]`).exists(), label).toBe(true);
    }
    expect(wrapper.findAll('.find-widget__option').map((option) => option.text())).toEqual(['Aa', 'ab', '.*']);
    expect(wrapper.get('.find-widget__row--replace').attributes('hidden')).toBeDefined();
  });

  test('reports the match count, navigates, and closes', async () => {
    const { wrapper, view } = mountWithPanel();

    await wrapper.get('.find-widget__input[name="find"]').setValue('alpha');
    await nextTick();
    expect(wrapper.get('.find-widget__count').text()).toBe('1 of 2');

    // "Next" walks into the first match and then on to the second one.
    await wrapper.get('.find-widget [aria-label="Next Match"]').trigger('click');
    expect([view.state.selection.main.from, view.state.selection.main.to]).toEqual([0, 5]);
    await wrapper.get('.find-widget [aria-label="Next Match"]').trigger('click');
    expect(view.state.selection.main.from).toBe(11);
    expect(wrapper.get('.find-widget__count').text()).toBe('2 of 2');

    // A case-sensitive search only counts the matching case, and a query with no
    // hit says so in the error colour.
    await wrapper.get('.find-widget__option[aria-label="Match Case"]').trigger('click');
    expect(wrapper.get('.find-widget__option[aria-label="Match Case"]').attributes('aria-pressed')).toBe('true');
    expect(wrapper.get('.find-widget__count').text()).toBe('1 of 1');
    await wrapper.get('.find-widget__input[name="find"]').setValue('ALPHA');
    await nextTick();
    expect(wrapper.get('.find-widget__count').text()).toBe('No results');
    expect(wrapper.get('.find-widget__count').classes()).toContain('find-widget__count--empty');

    await wrapper.get('.find-widget [aria-label="Close Find Widget"]').trigger('click');
    expect(wrapper.find('.find-widget').exists()).toBe(false);
    expect(searchPanelOpen(view.state)).toBe(false);
  });

  test('expands the replace row and replaces through the CodeMirror commands', async () => {
    const { wrapper, view } = mountWithPanel();

    await wrapper.get('.find-widget__input[name="find"]').setValue('alpha');
    await nextTick();
    await wrapper.get('.find-widget [aria-label="Toggle Replace"]').trigger('click');
    expect(wrapper.get('.find-widget__row--replace').attributes('hidden')).toBeUndefined();
    expect(wrapper.get('.find-widget [aria-label="Toggle Replace"]').attributes('aria-expanded')).toBe('true');

    await wrapper.get('.find-widget__input[name="replace"]').setValue('omega');
    await wrapper.get('.find-widget [aria-label="Replace All"]').trigger('click');
    await nextTick();
    expect(view.state.doc.toString()).toBe('omega\nbeta\nomega\n');
    expect(wrapper.get('.find-widget__count').text()).toBe('No results');
  });
});
