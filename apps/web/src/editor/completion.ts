import { acceptCompletion, autocompletion, completeAnyWord, completionKeymap, type CompletionContext, type CompletionResult, type CompletionSource } from '@codemirror/autocomplete';
import { syntaxTree } from '@codemirror/language';
import { EditorState, Prec, type Extension } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import { catalogCompletions, completionRuntime, memberCompletions } from './completionCatalog';

function inCommentOrString(context: CompletionContext): boolean {
  for (let node = syntaxTree(context.state).resolveInner(context.pos, -1); node; node = node.parent!) {
    if (/Comment|String|RegExp/.test(node.name)) return true;
  }
  return false;
}

/** Supplements the grammar's own context-aware sources, never replaces them. */
export function runtimeCompletionSource(runtime: string): CompletionSource {
  const name = completionRuntime(runtime);
  const catalog = catalogCompletions(runtime);
  const hyphenated = ['css', 'scss', 'html', 'tailwindcss', 'mermaid', 'xml'].includes(name);
  const wordPattern = hyphenated ? /[\p{L}\p{N}_$-]*/u : /[\p{L}\p{N}_$]*/u;
  const validFor = hyphenated ? /^[\p{L}\p{N}_$-]*$/u : /^[\p{L}\p{N}_$]*$/u;

  return (context): CompletionResult | null => {
    if (context.state.readOnly || inCommentOrString(context)) return null;
    const word = context.matchBefore(wordPattern);
    if (!word || (!word.text && !context.explicit)) {
      // A dot is a trigger for the small offline standard-library catalog.
      const member = context.matchBefore(/[$\p{L}_][$\p{L}\p{N}_]*\.[\p{L}\p{N}_$]*/u);
      if (!member) return null;
    }
    const from = word?.from ?? context.pos;
    const before = context.state.sliceDoc(Math.max(0, from - 120), from);
    const object = /([$\p{L}_][$\p{L}\p{N}_]*)\.$/u.exec(before)?.[1];
    if (object) {
      const options = memberCompletions(runtime, object);
      return options.length ? { from, options, validFor } : null;
    }
    // Native HTML/XML sources own <tag and attribute completion. Bare snippet
    // prefixes (html, div, script) remain available without duplicating '<'.
    if (['html', 'xml'].includes(name) && /<\/?$/.test(before)) return null;
    if (!catalog.length) return null;
    return { from, options: catalog, validFor };
  };
}

/** Word suggestions also support an unrecognised DSL, using the open document. */
export const documentWordCompletions: CompletionSource = (context) => {
  if (context.state.readOnly || inCommentOrString(context)) return null;
  return completeAnyWord(context);
};

export function sourceCompletion(runtime: string, quickSuggestions = true): Extension {
  const source = runtimeCompletionSource(runtime);
  return [
    // Adding language data preserves CodeMirror's native HTML/CSS/SQL and local
    // variable completion sources. An override would silently disable them.
    EditorState.languageData.of(() => [{ autocomplete: source }, { autocomplete: documentWordCompletions }]),
    autocompletion({ activateOnTyping: quickSuggestions, activateOnTypingDelay: 75, maxRenderedOptions: 100, defaultKeymap: false, tooltipClass: () => 'source-completion' }),
    Prec.highest(keymap.of([
      ...completionKeymap,
      // Active snippet fields use their own, higher-priority Tab bindings. When
      // no completion is open this returns false and normal indentation runs.
      { key: 'Tab', run: acceptCompletion },
    ])),
  ];
}
